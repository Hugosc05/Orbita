const clients = new Map();

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

export function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) clients.delete(userId);
}

export function push(userId, type, payload) {
  const set = clients.get(userId);
  if (!set || !set.size) return;
  const data = JSON.stringify({ type, payload, at: Date.now() });
  set.forEach(res => {
    try {
      res.write("event: orbita\ndata: " + data + "\n\n");
    } catch (err) {
      set.delete(res);
    }
  });
}

export const clientCount = userId => (clients.get(userId) || new Set()).size;
