import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";

export default function ConfirmModal({
  isOpen,
  title = "Confirm Action",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "danger", // "danger" | "warning" | "info"
}) {
  if (!isOpen) return null;
  const MotionContainer = motion.div;

  const iconColors = {
    danger: "text-red-500 bg-red-100 dark:bg-red-900/30",
    warning: "text-amber-500 bg-amber-100 dark:bg-amber-900/30",
    info: "text-amber-500 bg-amber-100 dark:bg-amber-900/30",
  };

  const buttonColors = {
    danger: "bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white",
    warning: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-500 text-white",
    info: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-500 text-white",
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 backdrop-blur-sm p-4">
        <MotionContainer
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800"
        >
          <div className="flex items-start">
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${iconColors[variant]}`}>
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="ml-4 mt-1">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">{title}</h3>
              <div className="mt-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
              </div>
            </div>
          </div>
          
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`inline-flex justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${buttonColors[variant]}`}
            >
              {confirmText}
            </button>
          </div>
        </MotionContainer>
      </div>
    </AnimatePresence>
  );
}


