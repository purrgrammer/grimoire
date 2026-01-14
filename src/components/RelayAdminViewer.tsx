/**
 * Relay Admin Viewer
 *
 * NIP-86 Relay Management API interface.
 * Shows relay metadata (NIP-11) and admin controls for supported methods.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Copy,
  CopyCheck,
  RefreshCw,
  Shield,
  Settings,
  Filter,
  Globe,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useRelayInfo } from "@/hooks/useRelayInfo";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";
import { Button } from "./ui/button";
import { NIPBadge } from "./NIPBadge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import {
  Nip86Client,
  Nip86AuthError,
  categoryHasMethods,
} from "@/lib/nip86-client";
import accountManager from "@/services/accounts";
import type { EventTemplate, NostrEvent } from "nostr-tools/core";
import { MetadataSection } from "./relay-admin/MetadataSection";
import { ModerationSection } from "./relay-admin/ModerationSection";
import { KindFilterSection } from "./relay-admin/KindFilterSection";
import { IpBlockingSection } from "./relay-admin/IpBlockingSection";

export interface RelayAdminViewerProps {
  url: string;
}

export function RelayAdminViewer({ url }: RelayAdminViewerProps) {
  const info = useRelayInfo(url);
  const { copy, copied } = useCopy();
  const { state } = useGrimoire();
  const hasAccount = !!state.activeAccount?.pubkey;

  // NIP-86 state
  const [supportedMethods, setSupportedMethods] = useState<string[] | null>(
    null,
  );
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);

  // Create signer function from active account
  const getSigner = useCallback(() => {
    const account = accountManager.active;
    if (!account?.signer) return null;

    return async (event: EventTemplate): Promise<NostrEvent> => {
      const signed = await account.signer!.signEvent(event);
      return signed as NostrEvent;
    };
  }, []);

  // Create NIP-86 client
  const getClient = useCallback(() => {
    const signer = getSigner();
    if (!signer) return null;
    return new Nip86Client(url, signer);
  }, [url, getSigner]);

  // Fetch supported methods
  const fetchSupportedMethods = useCallback(async () => {
    const client = getClient();
    if (!client) {
      setMethodsError("No active account");
      return;
    }

    setMethodsLoading(true);
    setMethodsError(null);

    try {
      const methods = await client.supportedMethods();
      setSupportedMethods(methods);
    } catch (error) {
      if (error instanceof Nip86AuthError) {
        setMethodsError("Unauthorized - you may not have admin access");
      } else {
        setMethodsError(
          error instanceof Error ? error.message : "Failed to fetch methods",
        );
      }
      setSupportedMethods(null);
    } finally {
      setMethodsLoading(false);
    }
  }, [getClient]);

  // Fetch methods on mount if account is available
  useEffect(() => {
    if (hasAccount) {
      fetchSupportedMethods();
    }
  }, [hasAccount, fetchSupportedMethods]);

  // Check if relay supports NIP-86
  const supportsNip86 = info?.supported_nips?.includes(86);

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-2xl font-bold">
            {info?.name || "Unknown Relay"}
          </h2>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            {url}
            <Button
              variant="link"
              size="icon"
              className="size-4 text-muted-foreground"
              onClick={() => copy(url)}
            >
              {copied ? (
                <CopyCheck className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>
          </div>
          {info?.description && (
            <p className="text-sm mt-2 text-muted-foreground">
              {info.description}
            </p>
          )}
        </div>
      </div>

      {/* NIP-86 Support Status */}
      {!supportsNip86 && info && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
          <AlertCircle className="size-4" />
          <span>
            This relay does not advertise NIP-86 support. Admin features may not
            be available.
          </span>
        </div>
      )}

      {/* No Account Warning */}
      {!hasAccount && (
        <div className="flex items-center gap-2 text-sm text-yellow-500 bg-yellow-500/10 p-3 rounded-md">
          <Shield className="size-4" />
          <span>
            Sign in with an account to access admin features. Only relay
            metadata is shown.
          </span>
        </div>
      )}

      {/* Supported NIPs */}
      {info?.supported_nips && info.supported_nips.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold text-sm">Supported NIPs</h3>
          <div className="flex flex-wrap gap-2">
            {info.supported_nips.map((num: number) => (
              <NIPBadge
                key={num}
                nipNumber={String(num).padStart(2, "0")}
                showName={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Admin Sections */}
      {hasAccount && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Admin Controls</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchSupportedMethods}
              disabled={methodsLoading}
            >
              {methodsLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>

          {/* Loading State */}
          {methodsLoading && !supportedMethods && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Checking admin access...</span>
            </div>
          )}

          {/* Error State */}
          {methodsError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <AlertCircle className="size-4" />
              <span>{methodsError}</span>
            </div>
          )}

          {/* Admin Sections Accordion */}
          {supportedMethods && supportedMethods.length > 0 && (
            <Accordion type="multiple" className="w-full">
              {/* Metadata Section */}
              {categoryHasMethods("metadata", supportedMethods) && (
                <AccordionItem value="metadata">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Settings className="size-4" />
                      <span>Relay Metadata</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <MetadataSection
                      url={url}
                      getClient={getClient}
                      supportedMethods={supportedMethods}
                      currentInfo={info}
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Moderation Section */}
              {categoryHasMethods("moderation", supportedMethods) && (
                <AccordionItem value="moderation">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Shield className="size-4" />
                      <span>Moderation</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ModerationSection
                      url={url}
                      getClient={getClient}
                      supportedMethods={supportedMethods}
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Kind Filtering Section */}
              {categoryHasMethods("kindFiltering", supportedMethods) && (
                <AccordionItem value="kinds">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Filter className="size-4" />
                      <span>Kind Filtering</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <KindFilterSection
                      url={url}
                      getClient={getClient}
                      supportedMethods={supportedMethods}
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* IP Blocking Section */}
              {categoryHasMethods("ipBlocking", supportedMethods) && (
                <AccordionItem value="ips">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Globe className="size-4" />
                      <span>IP Blocking</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <IpBlockingSection
                      url={url}
                      getClient={getClient}
                      supportedMethods={supportedMethods}
                    />
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
          )}

          {/* No Methods Available */}
          {supportedMethods && supportedMethods.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No admin methods available on this relay.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
