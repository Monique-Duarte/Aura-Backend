import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

// Inicializa o app do Firebase Admin para ter acesso ao Firestore
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
