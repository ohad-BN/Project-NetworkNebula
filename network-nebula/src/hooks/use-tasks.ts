import { useTaskStore } from '@/stores/task-store';

export const useTasks = () => {
  const store = useTaskStore();
  return {
    currentTask: store.currentTask,
    currentTaskStatus: store.currentTaskStatus,
    taskHistory: store.taskHistory,
    isPolling: store.isPolling,
    isLoading: store.isLoading,
    error: store.error,
    submitTask: store.submitTask,
    fetchTaskStatus: store.fetchTaskStatus,
    fetchTaskHistory: store.fetchTaskHistory,
    startPolling: store.startPolling,
    stopPolling: store.stopPolling,
    clearCurrentTask: store.clearCurrentTask,
    clearError: store.clearError,
  };
};

export { useTaskStore };
