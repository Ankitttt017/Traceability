// components/Footer.jsx
import { Heart, Github, Twitter, Linkedin } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-bg-card/30 backdrop-blur-xl border-t border-border/50 py-4 px-6">
      <div className="flex flex-col md:flex-row justify-between items-center text-sm text-text-muted">
        <div className="flex items-center space-x-2">
          <span>© 2026 copyright V-0.1</span>
        </div>

        <div className="flex items-center space-x-4 mt-2 md:mt-0">
          <div className="flex items-center space-x-1">
            <span>Made by</span>
            <Heart size={14} className="text-danger" />
            <span>Rico Auto Industry</span>
          </div>
          
          
          <div className="flex items-center space-x-3 border-l border-border pl-3">
            
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;