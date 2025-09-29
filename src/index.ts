import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

// Inicializa o Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

/**
 * Interface que representa a estrutura de uma transação (Renda ou Despesa)
 * baseada no arquivo `types.ts` do seu projeto Aura.
 */
interface Transaction {
  // Campos obrigatórios em ambas as transações
  description: string;
  amount: number;
  category: string;
  isFixed: boolean;
  date: admin.firestore.Timestamp;
  dayOfMonth?: number;
  creditCardId?: string;
  paid?: boolean;
  // Campos opcionais que podem existir
}

/**
 * Esta função é executada todos os dias à 1h da manhã.
 * Ela é projetada para funcionar com a estrutura do app Aura:
 * users/{userId}/incomes/{incomeId} e users/{userId}/expenses/{expenseId}.
 * Ela lê os campos `isFixed` e `dayOfMonth` para criar novos lançamentos.
 */
export const processRecurringTransactions = onSchedule(
  {
    schedule: "every day 01:00",
    timeZone: "America/Sao_Paulo",
  },
  async (event) => {
    logger.info("Iniciando verificação de transações recorrentes para o app Aura.", { structuredData: true });

    const today = new Date().getDate();

    // --- Processamento de Rendas Recorrentes ---
    try {
      const recurringIncomes = await db
        .collectionGroup("incomes")
        .where("isFixed", "==", true)
        .where("dayOfMonth", "==", today)
        .get();

      if (recurringIncomes.empty) {
        logger.info("Nenhuma renda recorrente para processar hoje.");
      } else {
        const promises = recurringIncomes.docs.map(async (doc) => {
          // Usamos "as Transaction" para o TypeScript entender a estrutura dos dados
          const incomeData = doc.data() as Transaction;
          const userId = doc.ref.parent.parent!.id;

          const newIncome = {
            ...incomeData,
            date: admin.firestore.Timestamp.now(),
            isFixed: false,
            originalFixedId: doc.id,
          };

          logger.info(`Lançando renda recorrente '${incomeData.description}' para o usuário ${userId}`);
          return db.collection(`users/${userId}/incomes`).add(newIncome);
        });
        await Promise.all(promises);
        logger.info(`${promises.length} rendas recorrentes processadas com sucesso.`);
      }
    } catch (error) {
      logger.error("Erro ao processar rendas recorrentes:", error);
    }

    // --- Processamento de Despesas Recorrentes ---
    try {
      const recurringExpenses = await db
        .collectionGroup("expenses")
        .where("isFixed", "==", true)
        .where("dayOfMonth", "==", today)
        .get();

      if (recurringExpenses.empty) {
        logger.info("Nenhuma despesa recorrente para processar hoje.");
      } else {
        const promises = recurringExpenses.docs.map(async (doc) => {
          const expenseData = doc.data() as Transaction;
          const userId = doc.ref.parent.parent!.id;

          const newExpense = {
            ...expenseData,
            date: admin.firestore.Timestamp.now(),
            isFixed: false,
            originalFixedId: doc.id,
          };

          logger.info(`Lançando despesa recorrente '${expenseData.description}' para o usuário ${userId}`);
          return db.collection(`users/${userId}/expenses`).add(newExpense);
        });
        await Promise.all(promises);
        logger.info(`${promises.length} despesas recorrentes processadas com sucesso.`);
      }
    } catch (error) {
      logger.error("Erro ao processar despesas recorrentes:", error);
    }
  }
);