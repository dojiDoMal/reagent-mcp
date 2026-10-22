/**
 * Classic Redux store (redux 4 + react-redux 7), the v1 target.
 * The debug adapter only needs getState()/subscribe(), so this works
 * unchanged with Redux Toolkit too.
 */
import { createStore, combineReducers, type AnyAction } from "redux";

interface AuthState {
  user: { id: number; name: string } | null;
  lastLogin: string | null;
}

const initialAuth: AuthState = { user: null, lastLogin: null };

function authReducer(state: AuthState = initialAuth, action: AnyAction): AuthState {
  switch (action.type) {
    case "auth/login":
      return {
        user: action.payload,
        lastLogin: new Date().toISOString(),
      };
    case "auth/logout":
      return initialAuth;
    default:
      return state;
  }
}

const rootReducer = combineReducers({
  auth: authReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export const store = createStore(rootReducer);
