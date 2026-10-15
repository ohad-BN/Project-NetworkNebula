import { useUIStore } from '@/stores/ui-store';

export const useToast = () => {
  const store = useUIStore();
  return {
    toasts: store.toasts,
    addToast: store.addToast,
    removeToast: store.removeToast,
  };
};

export const useModal = () => {
  const store = useUIStore();
  return {
    modals: store.modals,
    openModal: store.openModal,
    closeModal: store.closeModal,
  };
};

export const useUI = () => {
  const store = useUIStore();
  return {
    isDarkMode: store.isDarkMode,
    isSidebarCollapsed: store.isSidebarCollapsed,
    isLoading: store.isLoading,
    globalLoadingMessage: store.globalLoadingMessage,
    toggleDarkMode: store.toggleDarkMode,
    toggleSidebar: store.toggleSidebar,
    setGlobalLoading: store.setGlobalLoading,
  };
};

export { useUIStore };
