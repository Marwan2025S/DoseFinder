export function getUserDisplayName(user, fallback = 'User') {
  const displayName = typeof user?.displayName === 'string'
    ? user.displayName.trim()
    : typeof user?.display_name === 'string'
      ? user.display_name.trim()
      : '';

  if (displayName) return displayName;

  const username = typeof user?.username === 'string' ? user.username.trim() : '';
  return username || fallback;
}

export function getUserInitials(user, fallback = 'U') {
  const displayName = getUserDisplayName(user, fallback);
  const parts = displayName.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  const firstPart = parts[0] || fallback;
  return firstPart.slice(0, 2).toUpperCase();
}
