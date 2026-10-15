import { create } from 'zustand';
import { taskService } from '@/services/api/tasks';
import type { Task, TaskStatus, TaskSubmission } from '@/types';

interface TaskState {
  currentTask: Task | null;
  currentTaskStatus: TaskStatus | null;
  taskHistory: Task[];
  isPolling: boolean;
  pollInterval: number | null;
  isLoading: boolean;
  error: string | null;
}

interface TaskActions {
  submitTask: (data: TaskSubmission) => Promise<Task>;
  fetchTaskStatus: (taskId: string) => Promise<void>;
  fetchTaskHistory: () => Promise<void>;
  startPolling: (taskId: string, interval?: number) => void;
  stopPolling: () => void;
  clearCurrentTask: () => void;
  clearError: () => void;
}

type TaskStore = TaskState & TaskActions;

const initialState: TaskState = {
  currentTask: null,
  currentTaskStatus: null,
  taskHistory: [],
  isPolling: false,
  pollInterval: null,
  isLoading: false,
  error: null,
};

export const useTaskStore = create<TaskStore>()((set, get) => ({
  ...initialState,
  submitTask: async (data) => { set({isLoading:true,error:null}); try { const task=await taskService.submit(data); set({currentTask:task,isLoading:false}); return task; } catch(error) { set({error:error instanceof Error?error.message:'Task submission failed',isLoading:false}); throw error; } },
  fetchTaskStatus: async (taskId) => { set({isLoading:true,error:null}); try { const status=await taskService.status(taskId); set({currentTaskStatus:status,isLoading:false}); } catch(error) { set({error:error instanceof Error?error.message:'Failed to fetch task status',isLoading:false}); } },
  fetchTaskHistory: async () => { set({isLoading:true,error:null}); try { const {tasks}=await taskService.list(); set({taskHistory:tasks,isLoading:false}); } catch(error) { set({error:error instanceof Error?error.message:'Failed to fetch task history',isLoading:false}); } },
  startPolling: (taskId, interval=3000) => { const {stopPolling,fetchTaskStatus}=get(); stopPolling(); set({isPolling:true}); fetchTaskStatus(taskId); const id=window.setInterval(()=>{fetchTaskStatus(taskId);},interval); set({pollInterval:id}); },
  stopPolling: () => { const {pollInterval}=get(); if(pollInterval){clearInterval(pollInterval); set({pollInterval:null,isPolling:false});} },
  clearCurrentTask: () => { get().stopPolling(); set({currentTask:null,currentTaskStatus:null}); },
  clearError: () => set({error:null}),
}));

export const selectCurrentTask=(state:TaskStore)=>state.currentTask;
export const selectCurrentTaskStatus=(state:TaskStore)=>state.currentTaskStatus;
export const selectTaskHistory=(state:TaskStore)=>state.taskHistory;
export const selectIsPolling=(state:TaskStore)=>state.isPolling;
export const selectIsLoading=(state:TaskStore)=>state.isLoading;
export const selectError=(state:TaskStore)=>state.error;
