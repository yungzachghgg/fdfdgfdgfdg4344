// LuckBlox Authentication System
const AUTH_KEY = 'LuckBlox_auth';
const USER_KEY = 'LuckBlox_users';
const BANS_KEY = 'LuckBlox_bans';
const REPORTS_KEY = 'LuckBlox_reports';

class Auth {
    static init() {
        // Initialize admin account Flux18459
        const users = this.getUsers();
        
        // Create/reset Flux18459 admin account
        users['Flux18459'] = {
            username: 'Flux18459',
            password: 'Flux18459',
            robux: 999999999,
            isAdmin: true,
            created: new Date().toISOString()
        };
        
        this.saveUsers(users);
    }

    static getUsers() {
        const users = localStorage.getItem(USER_KEY);
        return users ? JSON.parse(users) : {};
    }

    static saveUsers(users) {
        localStorage.setItem(USER_KEY, JSON.stringify(users));
    }

    static register(username, password) {
        const users = this.getUsers();
        if (users[username]) {
            return { success: false, message: 'Username already exists' };
        }
        
        // Prevent registration of reserved admin username
        if (username.toLowerCase() === 'flux18459' || username.toLowerCase() === 'admin') {
            return { success: false, message: 'This username is reserved' };
        }
        
        users[username] = {
            username,
            password,
            robux: 100, // Starting bonus
            created: new Date().toISOString()
        };
        
        this.saveUsers(users);
        return { success: true, message: 'Account created successfully!' };
    }

    static login(username, password) {
        const users = this.getUsers();
        const user = users[username];
        
        if (!user || user.password !== password) {
            return { success: false, message: 'Invalid username or password' };
        }
        
        // Check if user is banned
        if (user.banned) {
            return { 
                success: false, 
                message: `Account banned: ${user.banReason || 'No reason provided'}`,
                banned: true
            };
        }
        
        const session = {
            username: user.username,
            robux: user.robux,
            isAdmin: user.isAdmin || false,
            loginTime: new Date().toISOString()
        };
        
        localStorage.setItem(AUTH_KEY, JSON.stringify(session));
        return { success: true, message: 'Login successful!' };
    }

    static logout() {
        localStorage.removeItem(AUTH_KEY);
        window.location.href = 'login.html';
    }

    static getCurrentUser() {
        const session = localStorage.getItem(AUTH_KEY);
        if (!session) return null;
        
        const userData = JSON.parse(session);
        const users = this.getUsers();
        const user = users[userData.username];
        
        if (user) {
            // Use users storage for robux (authoritative), session for other fields
            return { ...user, ...userData, robux: user.robux };
        }
        return null;
    }

    static updateRobux(amount) {
        const currentUser = this.getCurrentUser();
        if (!currentUser) return false;
        
        const users = this.getUsers();
        users[currentUser.username].robux = amount;
        this.saveUsers(users);
        
        const session = JSON.parse(localStorage.getItem(AUTH_KEY));
        session.robux = amount;
        localStorage.setItem(AUTH_KEY, JSON.stringify(session));
        
        return true;
    }

    static isLoggedIn() {
        return this.getCurrentUser() !== null;
    }

    static requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
        }
    }

    static updateUI() {
        const user = this.getCurrentUser();
        const authButtons = document.getElementById('auth-buttons');
        const userDisplay = document.getElementById('user-display');
        const robuxDisplay = document.getElementById('robux-display');
        
        if (user) {
            if (authButtons) authButtons.style.display = 'none';
            if (userDisplay) {
                userDisplay.style.display = 'flex';
                userDisplay.style.alignItems = 'center';
                userDisplay.style.gap = '15px';
                
                // Add admin badge if user is admin
                const adminBadge = user.isAdmin ? `
                    <a href="admin.html" style="
                        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                        border: 2px solid #ef4444;
                        border-radius: 25px;
                        padding: 8px 16px;
                        color: white;
                        font-weight: bold;
                        font-size: 12px;
                        text-decoration: none;
                        text-transform: uppercase;
                        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
                    ">🛡️ ADMIN</a>
                ` : '';
                
                userDisplay.innerHTML = `
                    <div style="
                        background: linear-gradient(135deg, rgba(249, 195, 55, 0.2) 0%, rgba(246, 143, 33, 0.1) 100%);
                        border: 2px solid #F9C337;
                        border-radius: 25px;
                        padding: 8px 20px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        font-weight: bold;
                        box-shadow: 0 4px 15px rgba(249, 195, 55, 0.3);
                    ">
                        <span style="font-size: 18px;">💰</span>
                        <span style="color: #F9C337; font-size: 16px;" id="robux-balance">${user.robux.toLocaleString()}</span>
                        <span style="color: #F9C337; font-size: 14px;">R$</span>
                    </div>
                    <div style="
                        background: linear-gradient(135deg, #39416d 0%, #2d3561 100%);
                        border-radius: 25px;
                        padding: 8px 20px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                    ">
                        <span style="font-size: 18px;">👤</span>
                        <span style="color: white; font-weight: bold; font-size: 16px;">${user.username}</span>
                    </div>
                    ${adminBadge}
                    <button onclick="Auth.logout()" style="
                        background: linear-gradient(135deg, #cf2e2e 0%, #a82525 100%);
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 25px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                        box-shadow: 0 4px 15px rgba(207, 46, 46, 0.4);
                        transition: all 0.3s ease;
                    " onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 6px 20px rgba(207, 46, 46, 0.6)'" 
                    onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 15px rgba(207, 46, 46, 0.4)'">Logout</button>
                `;
            }
        } else {
            if (authButtons) authButtons.style.display = 'flex';
            if (userDisplay) userDisplay.style.display = 'none';
        }
    }

    // Admin Methods
    static isAdmin() {
        const user = this.getCurrentUser();
        return user && user.isAdmin === true;
    }

    static requireAdmin() {
        if (!this.isAdmin()) {
            window.location.href = 'dashboard.html';
        }
    }

    // Reporting System
    static reportUser(reportedUser, reason, reporter, messageId = null) {
        const reports = this.getReports();
        const report = {
            id: Date.now(),
            reportedUser,
            reporter,
            reason,
            messageId,
            status: 'pending',
            timestamp: new Date().toISOString(),
            handledBy: null,
            handledAt: null
        };
        reports.unshift(report);
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reports.slice(0, 100)));
        return { success: true, reportId: report.id };
    }

    static getReports() {
        const reports = localStorage.getItem(REPORTS_KEY);
        return reports ? JSON.parse(reports) : [];
    }

    static resolveReport(reportId, action, adminUsername) {
        const reports = this.getReports();
        const report = reports.find(r => r.id === reportId);
        if (report) {
            report.status = 'resolved';
            report.action = action;
            report.handledBy = adminUsername;
            report.handledAt = new Date().toISOString();
            
            if (action === 'ban') {
                this.banUser(report.reportedUser, 'Banned by admin: ' + report.reason, adminUsername);
            }
            
            localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
            return { success: true };
        }
        return { success: false, message: 'Report not found' };
    }

    // Ban System
    static banUser(username, reason, bannedBy) {
        const users = this.getUsers();
        const bans = this.getBans();
        
        if (users[username]) {
            users[username].banned = true;
            users[username].banReason = reason;
            users[username].bannedBy = bannedBy;
            users[username].bannedAt = new Date().toISOString();
            this.saveUsers(users);
            
            bans.unshift({
                username,
                reason,
                bannedBy,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem(BANS_KEY, JSON.stringify(bans.slice(0, 50)));
            return { success: true };
        }
        return { success: false, message: 'User not found' };
    }

    static unbanUser(username) {
        const users = this.getUsers();
        if (users[username]) {
            delete users[username].banned;
            delete users[username].banReason;
            delete users[username].bannedBy;
            delete users[username].bannedAt;
            this.saveUsers(users);
            return { success: true };
        }
        return { success: false, message: 'User not found' };
    }

    static getBans() {
        const bans = localStorage.getItem(BANS_KEY);
        return bans ? JSON.parse(bans) : [];
    }

    static isBanned(username) {
        const users = this.getUsers();
        return users[username] && users[username].banned === true;
    }

    static getBannedUsers() {
        const users = this.getUsers();
        return Object.values(users).filter(u => u.banned === true);
    }
}

// Initialize auth on page load
Auth.init();
document.addEventListener('DOMContentLoaded', () => {
    Auth.updateUI();
});
