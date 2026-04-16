// LuckBlox Game API Service
const API_BASE = window.location.origin;

class GameAPI {
    static async placeBet(game, bet, data = {}) {
        const token = localStorage.getItem('LuckBlox_auth');
        if (!token) throw new Error('Not authenticated');
        
        const session = JSON.parse(token);
        
        const response = await fetch(`${API_BASE}/api/game/bet`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.username}`
            },
            body: JSON.stringify({ game, bet, ...data })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Bet failed');
        }
        
        const result = await response.json();
        
        // Update local balance
        if (result.balance !== undefined) {
            Auth.updateRobux(result.balance);
        }
        
        return result;
    }
    
    static async cashout(game, data = {}) {
        const token = localStorage.getItem('LuckBlox_auth');
        if (!token) throw new Error('Not authenticated');
        
        const session = JSON.parse(token);
        
        const response = await fetch(`${API_BASE}/api/game/cashout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.username}`
            },
            body: JSON.stringify({ game, ...data })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Cashout failed');
        }
        
        const result = await response.json();
        
        // Update local balance
        if (result.balance !== undefined) {
            Auth.updateRobux(result.balance);
        }
        
        return result;
    }
    
    static async getBalance() {
        const token = localStorage.getItem('LuckBlox_auth');
        if (!token) throw new Error('Not authenticated');
        
        const session = JSON.parse(token);
        
        const response = await fetch(`${API_BASE}/api/user/balance`, {
            headers: {
                'Authorization': `Bearer ${session.username}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get balance');
        }
        
        const result = await response.json();
        
        // Update local balance
        if (result.balance !== undefined) {
            Auth.updateRobux(result.balance);
        }
        
        return result.balance;
    }
    
    static async getGameHistory(game, limit = 20) {
        const token = localStorage.getItem('LuckBlox_auth');
        if (!token) throw new Error('Not authenticated');
        
        const session = JSON.parse(token);
        
        const response = await fetch(`${API_BASE}/api/game/history?game=${game}&limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${session.username}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get history');
        }
        
        return response.json();
    }
}

// Export for use in games
window.GameAPI = GameAPI;
