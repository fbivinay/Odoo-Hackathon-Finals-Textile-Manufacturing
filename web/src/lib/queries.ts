import { dayFromToday } from './format'

// The order book a screen needs: everything due from 90 days ago onward. That covers every
// open order plus recent history without pulling all ~1,800 orders since 2023.
export const recentOrdersPath = () => `/orders?dueFrom=${dayFromToday(-90)}&limit=500`
