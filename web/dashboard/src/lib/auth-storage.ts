const KEY = 'logged_in';

export function setLoggedIn(): void {
  localStorage.setItem(KEY, '1');
}

export function clearLoggedIn(): void {
  localStorage.removeItem(KEY);
}

export function isLoggedIn(): boolean {
  return localStorage.getItem(KEY) === '1';
}
