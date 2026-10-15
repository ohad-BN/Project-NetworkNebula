import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Toast = { id: string; type: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string; };
type Modal = { id: string; type: 'deposit' | 'withdraw' | 'confirm' | 'custom'; isOpen: boolean; data?: unknown; };

interface UIState {
  toasts: Toast[];
  modals: Modal[];
  isDarkMode: boolean;
  isSidebarCollapsed: boolean;
  isLoading: boolean;
  globalLoadingMessage: string | null;
}

interface UIActions {
  addToast: (toast: Omit<Toast,'id'>) => void;
  removeToast: (id: string) => void;
  openModal: (modal: Omit<Modal,'id'|'isOpen'>) => string;
  closeModal: (id: string) => void;
  toggleDarkMode: () => void;
  toggleSidebar: () => void;
  setGlobalLoading: (isLoading: boolean, message?: string) => void;
}

type UIStore = UIState & UIActions;
let toastCounter=0; let modalCounter=0;

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => (
      {
        toasts: [],
        modals: [],
        isDarkMode: false,
        isSidebarCollapsed: false,
        isLoading: false,
        globalLoadingMessage: null,
        addToast: (toast) => { const id='toast-'+(++toastCounter); set((state) => ({toasts: [...state.toasts, {...toast, id}]})); setTimeout(() => { get().removeToast(id); }, 5000); },
        removeToast: (id) => { set((state) => ({toasts: state.toasts.filter((t) => t.id !== id)})); },
        openModal: (modal) => { const id='modal-'+(++modalCounter); set((state) => ({modals: [...state.modals, {...modal, id, isOpen: true}]})); return id; },
        closeModal: (id) => { set((state) => ({modals: state.modals.map((m) => m.id === id ? {...m, isOpen: false} : m)})); },
        toggleDarkMode: () => { set((state) => ({isDarkMode: !state.isDarkMode})); },
        toggleSidebar: () => { set((state) => ({isSidebarCollapsed: !state.isSidebarCollapsed})); },
        setGlobalLoading: (isLoading, message) => { set({isLoading, globalLoadingMessage: message || null}); },
      }
    ),
    { name: 'ui-preferences', partialize: (state) => ({isDarkMode: state.isDarkMode, isSidebarCollapsed: state.isSidebarCollapsed}) }
  )
);

export const selectToasts=(state:UIStore)=>state.toasts;
export const selectModals=(state:UIStore)=>state.modals;
export const selectIsDarkMode=(state:UIStore)=>state.isDarkMode;
export const selectIsSidebarCollapsed=(state:UIStore)=>state.isSidebarCollapsed;
export const selectIsLoading=(state:UIStore)=>state.isLoading;
