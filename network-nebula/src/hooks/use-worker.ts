import { useWorkerStore } from '@/stores/worker-store';

export const useWorker = () => {
  const store = useWorkerStore();
  return {
    workerId: store.workerId,
    status: store.status,
    currentTaskId: store.currentTaskId,
    totalTasks: store.totalTasks,
    completedTasks: store.completedTasks,
    failedTasks: store.failedTasks,
    earnings: store.earnings,
    isLoading: store.isLoading,
    error: store.error,
    setWorkerId: store.setWorkerId,
    setStatus: store.setStatus,
    setCurrentTask: store.setCurrentTask,
    incrementCompleted: store.incrementCompleted,
    incrementFailed: store.incrementFailed,
    addEarnings: store.addEarnings,
    reset: store.reset,
    clearError: store.clearError,
  };
};

export { useWorkerStore };
