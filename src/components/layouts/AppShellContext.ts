import { createContext, useContext } from "react";

interface AppShellContextType {
  openCommandLauncher: () => void;
}

export const AppShellContext = createContext<AppShellContextType>({
  openCommandLauncher: () => {},
});

export const useAppShell = () => useContext(AppShellContext);
