import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessPath, normalizeRole } from '@/lib/rbac';
import {
  Users,
  Home,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  CreditCard,
  Wallet,
  UserCog,
  ClipboardList,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SidebarItem {
  icon: React.ReactNode;
  label: string;
  href: string;
}

interface SidebarProps {
  sidebarItems?: SidebarItem[];
  links?: SidebarItem[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onLogout?: () => void;
}

// Define the default links that will always be available
const defaultLinks = [
  { icon: <Home className="w-5 h-5" />, label: "Dashboard", href: "/dashboard" },
  { icon: <Users className="w-5 h-5" />, label: "Members", href: "/members" },
  { icon: <ClipboardList className="w-5 h-5" />, label: "Applications", href: "/applications" },
  { icon: <Calendar className="w-5 h-5" />, label: "Cases", href: "/cases" },
  { icon: <CreditCard className="w-5 h-5" />, label: "Transactions", href: "/transactions" },
  { icon: <Wallet className="w-5 h-5" />, label: "Accounts", href: "/accounts" },
  { icon: <BarChart3 className="w-5 h-5" />, label: "Reports", href: "/reports" },
  { icon: <UserCog className="w-5 h-5" />, label: "Users", href: "/users" },
  { icon: <Settings className="w-5 h-5" />, label: "Settings", href: "/settings" }
];

const Sidebar = ({ sidebarItems, links, collapsed = false, onToggleCollapsed, onLogout }: SidebarProps) => {
  const { logout } = useAuth();
  const location = useLocation();
  const handleLogout = onLogout || logout;

  const currentUserRole = (() => {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) return null;
    try {
      const user = JSON.parse(userStr);
      return normalizeRole(user?.role as string | undefined);
    } catch {
      return null;
    }
  })();
  const hasMemberSession = !!localStorage.getItem('member_member_id');
  const homeHref = hasMemberSession ? '/member/dashboard' : '/dashboard';
  
  // Use the passed sidebarItems if provided, otherwise use the default ones
  const items = (sidebarItems || links || defaultLinks).filter((item) => {
    // Member portal runs on separate session keys and does not use currentUser role.
    // If we are in a member session, allow member routes.
    if (hasMemberSession && item.href.startsWith('/member/')) return true;
    return canAccessPath(item.href, currentUserRole);
  });
  
  useEffect(() => {
    // Update active state when location changes
  }, [items, location.pathname]);

  return (
    <aside className="bg-sidebar w-full h-full flex flex-col border-r border-sidebar-border shadow-sm z-10 transition-colors duration-300">
      <div className={cn("flex-shrink-0 p-3 md:p-4 lg:p-5", collapsed && "p-2 md:p-3")}>
        <div className="flex items-center justify-between gap-2">
          <Link to={homeHref} className={cn("flex items-center", collapsed ? "justify-center" : "")} aria-label="Go to dashboard">
            {collapsed ? (
              <div className="h-8 w-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center text-xs font-bold shadow-sm">
                MW
              </div>
            ) : (
              <img
                src="/malanga-logo.png"
                alt="Malanga Welfare Connect"
                className="h-9 w-auto md:h-10 object-contain"
                loading="eager"
              />
            )}
          </Link>
          {onToggleCollapsed && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onToggleCollapsed}
              className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className={cn("flex-1 py-3", collapsed ? "px-1.5" : "px-2")}>
        <nav className="space-y-0.5">
          {items && items.length > 0 ? (
            items.map((item) => {
              const isActive = location.pathname === item.href ||
                             (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    'flex items-center rounded-md py-2 text-xs md:text-sm font-medium transition-all duration-200 group whitespace-nowrap',
                    collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
                </Link>
              );
            })
          ) : (
            <div className="text-center text-xs text-muted-foreground py-6">No items</div>
          )}
        </nav>
      </ScrollArea>

      {/* Logout Button */}
      <div className={cn("border-t border-sidebar-border flex-shrink-0", collapsed ? "p-2" : "p-2 md:p-3")}>
        <Button
          variant="ghost"
          onClick={handleLogout}
          className={cn(
            "w-full text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive h-auto whitespace-nowrap",
            collapsed ? "justify-center px-2.5 py-2" : "justify-start gap-2 px-2.5 py-2"
          )}
          title="Logout"
          aria-label="Logout"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span className={cn("text-xs md:text-sm font-medium truncate", collapsed && "sr-only")}>Logout</span>
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
