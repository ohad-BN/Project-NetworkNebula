import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkerState {
  workerId: string | null;
  status: 'idle' | 'available' | 'busy' | 'offline';
  currentTaskId: string | null;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  earnings: number;
  isLoading: boolean;
  error: string | null;
}

interface WorkerActions {
  setWorkerId: (id: string | null) => void;
  setStatus: (status: 'idle' | 'available' | 'busy' | 'offline') => void;
  setCurrentTask: (taskId: string | null) => void;
  incrementCompleted: () => void;
  incrementFailed: () => void;
  addEarnings: (amount: number) => void;
  reset: () => void;
  clearError: () => void;
}

type WorkerStore = WorkerState & WorkerActions;

const initialState: WorkerState = {
  workerId: null,
  status: 'offline',
  currentTaskId: null,
  totalTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  earnings: 0,
  isLoading: false,
  error: null,
};

export const useWorkerStore = create<WorkerStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setWorkerId: (id) => set({workerId: id}),
      setStatus: (status) => set({status}),
      setCurrentTask: (taskId) => set({currentTaskId: taskId}),
      incrementCompleted: () => { const {completedTasks,totalTasks}=get(); set({completedTasks:completedTasks+1,totalTasks:totalTasks+1}); },
      incrementFailed: () => { const {failedTasks,totalTasks}=get(); set({failedTasks:failedTasks+1,totalTasks:totalTasks+1}); },
      addEarnings: (amount) => { const {earnings}=get(); set({earnings:earnings+amount}); },
      reset: () => set(initialState),
      clearError: () => set({error:null}),
    }),
    { name: 'worker-storage', partialize: (state) => ({workerId:state.workerId,status:state.status,totalTasks:state.totalTasks,completedTasks:state.completedTasks,failedTasks:state.failedTasks,earnings:state.earnings}) }
  )
);

export const selectWorkerId=(state:WorkerStore)=>state.workerId;
export const selectStatus=(state:WorkerStore)=>state.status;
export const selectCurrentTaskId=(state:WorkerStore)=>state.currentTaskId;
export const selectCompletedTasks=(state:WorkerStore)=>state.completedTasks;
export const selectFailedTasks=(state:WorkerStore)=>state.failedTasks;
export const selectEarnings=(state:WorkerStore)=>state.earnings;
