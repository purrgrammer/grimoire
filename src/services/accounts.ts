import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import pool from "./relay-pool";

const ACCOUNTS = "nostr-accounts";
const ACTIVE_ACCOUNT = "active-account";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.error(err);
  }
}

// Setup nostr connect signer methods before account restoration
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

const accountManager = new AccountManager();
registerCommonAccountTypes(accountManager);

// load all accounts
if (localStorage.getItem(ACCOUNTS)) {
  const accounts = localStorage.getItem(ACCOUNTS);
  if (accounts) {
    const json = safeParse(accounts);
    if (json) accountManager.fromJSON(json);
  }
}

// save accounts to localStorage when they change
accountManager.accounts$.subscribe(() => {
  localStorage.setItem(ACCOUNTS, JSON.stringify(accountManager.toJSON()));
});

// load active account
const activeAccountId = localStorage.getItem(ACTIVE_ACCOUNT);
// todo: make sure it's part of accounts
if (activeAccountId) {
  accountManager.setActive(activeAccountId);
}

// save active to localStorage
accountManager.active$.subscribe((account) => {
  if (account) localStorage.setItem(ACTIVE_ACCOUNT, account.id);
  else localStorage.removeItem(ACTIVE_ACCOUNT);
});

export default accountManager;
