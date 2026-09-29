import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import Footer from "../components/Footer";

const MainLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(min-width: 1280px)");
    const closeDrawerOnDesktop = (event) => {
      if (event.matches) setSidebarOpen(false);
    };
    if (media.matches) setSidebarOpen(false);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", closeDrawerOnDesktop);
      return () => media.removeEventListener("change", closeDrawerOnDesktop);
    }
    media.addListener(closeDrawerOnDesktop);
    return () => media.removeListener(closeDrawerOnDesktop);
  }, []);

  return (
    <div className="flex h-screen bg-bg-base text-text-main overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden"
          onClick={handleCloseSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - hidden on mobile, slides in when sidebarOpen */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-[260px] max-w-[88vw] xl:static xl:z-auto xl:w-auto transition-transform duration-300 ease-in-out
          ${sidebarOpen ? "translate-x-0 shadow-2xl shadow-black/40" : "-translate-x-full"} xl:translate-x-0`}
      >
        <Sidebar onClose={handleCloseSidebar} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header onMenuClick={handleToggleSidebar} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
};

export default MainLayout;
