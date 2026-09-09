import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../server/lib/supabase.js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serverUrl = process.env.AUTH_TEST_SERVER_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;
if (!url || !publishableKey) throw new Error("Supabase 공개 연결값이 필요합니다.");

const admin = getSupabaseAdmin();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = `Codex-${crypto.randomUUID()}-9!`;
const emails = [`codex-auth-a-${suffix}@example.com`, `codex-auth-b-${suffix}@example.com`];
const userIds = [];

const signIn = async (email) => {
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, token: data.session.access_token };
};

const getState = async (token) => {
  const response = await fetch(`${serverUrl}/api/accounts/me/state`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error}`);
  return data;
};

try {
  for (const email of emails) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userIds.push(data.user.id);
  }

  const [authA, authB] = await Promise.all(emails.map(signIn));
  const [stateA, stateB] = await Promise.all([getState(authA.token), getState(authB.token)]);
  const depositResponse = await fetch(`${serverUrl}/api/accounts/me/cash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authA.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "DEPOSIT_KRW", amount: 1234 }),
  });
  if (!depositResponse.ok) throw new Error(`입금 격리 테스트 실패: ${depositResponse.status}`);
  const [changedA, unchangedB] = await Promise.all([getState(authA.token), getState(authB.token)]);
  const [{ data: rowsA, error: rowsAError }, { data: rowsB, error: rowsBError }] = await Promise.all([
    authA.client.from("accounts").select("id,user_id,account_number"),
    authB.client.from("accounts").select("id,user_id,account_number"),
  ]);
  if (rowsAError) throw rowsAError;
  if (rowsBError) throw rowsBError;

  const unauthenticated = await fetch(`${serverUrl}/api/accounts/me/state`);
  const operationsResponse = await fetch(`${serverUrl}/api/operations/status`, { headers: { Authorization: `Bearer ${authA.token}` } });
  const operations = await operationsResponse.json();
  const unauthenticatedOperations = await fetch(`${serverUrl}/api/operations/status`);
  console.log(JSON.stringify({
    distinctAccounts: stateA.account.id !== stateB.account.id,
    startingBalances: [stateA.account.krwBalance, stateB.account.krwBalance],
    serverMutationIsolated: changedA.account.krwBalance === 10001234 && unchangedB.account.krwBalance === 10000000,
    rlsASeesOnlyOwn: rowsA.length === 1 && rowsA[0].user_id === userIds[0],
    rlsBSeesOnlyOwn: rowsB.length === 1 && rowsB[0].user_id === userIds[1],
    unauthenticatedStatus: unauthenticated.status,
    operationsReady: operationsResponse.ok && operations.ready === true,
    operationsStatus: operations.status,
    unauthenticatedOperationsStatus: unauthenticatedOperations.status,
  }));
} finally {
  for (const userId of userIds) await admin.auth.admin.deleteUser(userId);
}
