import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as functions from "firebase-functions";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {QueryDocumentSnapshot} from "firebase-admin/firestore";

// Inicializa o app do Firebase Admin uma única vez
admin.initializeApp();
const db = admin.firestore();

/**
 * Cria transações recorrentes para os usuários diariamente.
 */
export const createRecurringTransactions = onSchedule(
  {
    schedule: "every day 01:00",
    timeZone: "America/Sao_Paulo",
  },
  async () => { // Removido o parâmetro 'event' não utilizado
    logger.info("Iniciando a criação de transações recorrentes...");

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    try {
      const usersSnapshot = await db.collection("users").get();

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const recurringTxQuery = db
          .collection("users").doc(userId)
          .collection("transactions")
          .where("isRecurring", "==", true)
          .where("recurringDay", "==", currentDay);

        const recurringTxSnapshot = await recurringTxQuery.get();

        if (recurringTxSnapshot.empty) {
          continue;
        }

        for (const recurringDoc of recurringTxSnapshot.docs) {
          const recurringData = recurringDoc.data();
          const description = recurringData.description || "Transação";
          const startDate = new Date(currentYear, currentMonth, 1);
          const endDate = new Date(currentYear, currentMonth + 1, 0);

          const checkExistingQuery = db.collection("users").doc(userId)
            .collection("transactions")
            .where("recurringSourceId", "==", recurringDoc.id)
            .where("date", ">=", startDate)
            .where("date", "<=", endDate);

          const existingSnapshot = await checkExistingQuery.get();

          if (existingSnapshot.empty) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {recurringDay, ...baseTransaction} = recurringData;
            const newTransactionData = {
              ...baseTransaction,
              date: admin.firestore.Timestamp.fromDate(new Date()),
              isRecurring: false,
              recurringSourceId: recurringDoc.id,
            };

            await db.collection("users").doc(userId)
              .collection("transactions").add(newTransactionData);
            logger.info(
              `Transação "${description}" criada para o usuário ${userId}.`,
            );
          }
        }
      }
      logger.info("Processo concluído com sucesso!");
    } catch (error) {
      logger.error("Erro no processo de transações:", error);
    }
  },
);

/**
 * Gatilho que apaga todos os dados de um usuário quando ele é deletado do Auth.
 */
export const onUserDeletedFunction = functions.auth.user().onDelete(
  async (user: functions.auth.UserRecord) => {
    const uid = user.uid;
    logger.info(`Iniciando a exclusão dos dados para o usuário: ${uid}`);

    try {
      const userDocRef = db.doc(`users/${uid}`);
      const subcollections = [
        "transactions", "cards", "categories", "reserves", "settings",
      ];

      const promises = subcollections.map((subcollection) => {
        const path = `users/${uid}/${subcollection}`;
        return deleteCollectionByPath(path);
      });

      await Promise.all(promises);
      await userDocRef.delete();

      const partnershipsQuery = db.collection("partnerships")
        .where("members", "array-contains", uid);
      const partnershipsSnapshot = await partnershipsQuery.get();

      if (!partnershipsSnapshot.empty) {
        const batch = db.batch();
        partnershipsSnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }
      logger.info(`Limpeza completa para o usuário ${uid} finalizada.`);
      return null;
    } catch (error) {
      logger.error(`Erro ao excluir dados do usuário ${uid}:`, error);
      return null;
    }
  }
);

/**
 * Função Chamável que verifica se um e-mail existe no Firebase Auth.
 */
export const checkIfEmailExists = onCall((request) => {
  const email = request.data.email;

  if (!email || typeof email !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "O e-mail é obrigatório.",
    );
  }

  return admin.auth().getUserByEmail(email)
    .then(() => {
      return {exists: true};
    })
    .catch((error) => {
      if (error.code === "auth/user-not-found") {
        return {exists: false};
      }
      throw new HttpsError(
        "internal", "Ocorreu um erro ao verificar o e-mail.", error
      );
    });
});

/**
 * Exclui todos os documentos de uma coleção em lotes.
 * @param {string} collectionPath - O caminho da coleção a ser excluída.
 * @param {number} batchSize
 */
async function deleteCollectionByPath(collectionPath: string, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy("__name__").limit(batchSize);

  let snapshot = await query.get();
  while (snapshot.size > 0) {
    const batch = db.batch();
    snapshot.docs.forEach((doc: QueryDocumentSnapshot) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    snapshot = await query.get();
  }
}
