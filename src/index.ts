import {onSchedule} from "firebase-functions/v2/scheduler";
import * as functions from "firebase-functions";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

// Inicializa o app do Firebase Admin uma única vez
admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function agendada (v2) para rodar todos os dias à 1 da manhã.
 * Ela cria transações recorrentes (rendas e despesas) para os usuários.
 */
export const createRecurringTransactions = onSchedule(
  {
    schedule: "every day 01:00",
    timeZone: "America/Sao_Paulo",
  },
  async (event) => {
    logger.info("Iniciando a criação de transações recorrentes...");

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    try {
      const usersSnapshot = await db.collection("users").get();

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        logger.info(`Processando usuário: ${userId}`);

        const recurringTxQuery = db
          .collection("users")
          .doc(userId)
          .collection("transactions")
          .where("isRecurring", "==", true)
          .where("recurringDay", "==", currentDay);

        const recurringTxSnapshot = await recurringTxQuery.get();

        if (recurringTxSnapshot.empty) {
          logger.info(
            `Nenhuma transação recorrente para o dia ${currentDay}.`
          );
          continue;
        }

        for (const recurringDoc of recurringTxSnapshot.docs) {
          const recurringData = recurringDoc.data();
          const description = recurringData.description || "Transação";

          const startDate = new Date(currentYear, currentMonth, 1);
          const endDate = new Date(currentYear, currentMonth + 1, 0);

          const checkExistingQuery = db
            .collection("users")
            .doc(userId)
            .collection("transactions")
            .where("recurringSourceId", "==", recurringDoc.id)
            .where("date", ">=", startDate)
            .where("date", "<=", endDate);

          const existingSnapshot = await checkExistingQuery.get();

          if (existingSnapshot.empty) {
            const newTransactionData: { [key: string]: any } = {
              ...recurringData,
              date: admin.firestore.Timestamp.fromDate(new Date()),
              isRecurring: false,
              recurringSourceId: recurringDoc.id,
            };
            delete newTransactionData.recurringDay;

            await db
              .collection("users")
              .doc(userId)
              .collection("transactions")
              .add(newTransactionData);

            logger.info(
              `Transação "${description}" criada para o usuário ${userId}.`
            );
          } else {
            logger.info(
              `Transação "${description}" já existe para este mês.`
            );
          }
        }
      }
      logger.info("Processo concluído com sucesso!");
    } catch (error) {
      logger.error("Erro no processo de transações:", error);
    }
  }
);

export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;
  logger.info(`Iniciando a exclusão dos dados para o utilizador: ${uid}`);

  try {
    const userDocRef = db.doc(`users/${uid}`);

    const subcollections = [
      "transactions",
      "cards",
      "categories",
      "reserves",
      "settings",
    ];

    const promises = subcollections.map((subcollection) => {
      const path = `users/${uid}/${subcollection}`;
      logger.info(`Agendando exclusão da subcoleção em: ${path}`);
      return deleteCollectionByPath(path);
    });

    await Promise.all(promises);
    logger.info(`Todas as subcoleções do utilizador ${uid} foram excluídas.`);

    await userDocRef.delete();
    logger.info(`Documento principal do utilizador ${uid} foi excluído.`);
    
    const partnershipsRef = db.collection("partnerships");
    const partnershipsQuery = partnershipsRef.where("members", "array-contains", uid);
    const partnershipsSnapshot = await partnershipsQuery.get();
    
    if (!partnershipsSnapshot.empty) {
      const batch = db.batch();
      partnershipsSnapshot.forEach(doc => {
        logger.info(`Excluindo parceria ${doc.id}`);
        batch.delete(doc.ref);
      });
      await batch.commit();
      logger.info(`Parcerias do utilizador ${uid} foram excluídas.`);
    }

    logger.info(`Limpeza completa para o utilizador ${uid} finalizada com sucesso.`);
    return null;

  } catch (error) {
    logger.error(`Erro ao excluir dados do utilizador ${uid}:`, error);
    return null;
  }
});


async function deleteCollectionByPath(collectionPath: string, batchSize: number = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy("__name__").limit(batchSize);

  let snapshot = await query.get();
  while (snapshot.size > 0) {
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    snapshot = await query.get();
  }
}