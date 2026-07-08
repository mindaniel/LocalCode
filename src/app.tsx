import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { Splash } from "./components/Splash";
import { StatusBar } from "./components/StatusBar";
import { ThinkingDots } from "./components/ThinkingDots";
import { DiffView } from "./components/DiffView";
import { ConnectPopup } from "./components/ConnectPopup";
import { ModelPicker } from "./components/ModelPicker";
import { FilePicker } from "./components/FilePicker";
import { InfoPopup } from "./components/InfoPopup";
import { UserBlock } from "./components/UserBlock";
import { AgentBlock } from "./components/AgentBlock";
import { AgentRuntime } from "./agent/AgentRuntime";
import { ConfigManager } from "./config/ConfigManager";
import { PtyManager } from "./pty/PtyManager";
import { AgentMessage, ToolCall, Attachment } from "./shared/types";
import { BUILTIN_COMMANDS } from "./shared/constants";
import { checkForUpdate, UpdateInfo } from "./shared/updateChecker";
import { getAppVersion } from "./shared/version";
import {
  groupIntoTurns,
  getVisibleTurns,
  estimateTurnLines,
  parseThinking,
  getSuggestion,
  extractContextSize,
} from "./shared/utils";
import { loadAttachment, listCwdFiles } from "./shared/attachments";
import { globalCommandRegistry } from "./plugins/registry.js";
import { loadPlugins } from "./plugins/loader.js";
import { useSlashCommands } from "./hooks/useSlashCommands";

let _id = 0;
const nextId = () => String(++_id);

type AgentStatus = "idle" | "running" | "thinking" | "error";
interface ConfirmRequest {
  toolCall: ToolCall;
  reason: string;
  diffPreview?: import("./agent/AgentRuntime").DiffPreview;
  dangerous?: boolean;
}
interface AppProps {
  initialCommand?: string;
  cwd: string;
  onStatusChange?: (status: string, cwd: string) => void;
}

// ── App ───────────────────────────────────────────────────────────────────────
export const App: React.FC<AppProps> = ({
  initialCommand,
  cwd,
  onStatusChange,
}) => {
  const { exit } = useApp();
  const cm = ConfigManager.getInstance();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [currentTokens, setCurrentTokens] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const [history, setHistory] = useState<string[]>(() => cm.getHistory());
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [histIndex, setHistIndex] = useState(-1);
  const [pickerIdx, setPickerIdx] = useState(0);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [connectPopup, setConnectPopup] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [filePicker, setFilePicker] = useState(false);
  const [fileList, setFileList] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<"build" | "plan" | "debug">(() =>
    cm.get().debugMode ? "debug" : "build"
  );
  const [pluginCmds, setPluginCmds] = useState<
    Array<{ cmd: string; description: string }>
  >([]);
  const [convHistory, setConvHistory] = useState<
    import("./shared/types").Message[]
  >([]);
  const [infoPopup, setInfoPopup] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [infoScroll, setInfoScroll] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [browseMode, setBrowseMode] = useState(false);
  const [focusedToolIdx, setFocusedToolIdx] = useState(0);

  const toolResultMsgIds = messages
    .filter(
      (m) =>
        m.type === "tool_result" &&
        m.toolCall?.tool !== "edit_file" &&
        !(m.toolCall?.tool === "write_file" && m.toolResult?.meta?.diffPath),
    )
    .map((m) => m.id);
  const focusedToolId = browseMode ? (toolResultMsgIds[focusedToolIdx] ?? null) : null;

  const taskQueueRef = useRef<string[]>([]);
  const crashCompactRef = useRef(false);
  const agentRef = useRef<AgentRuntime | null>(null);
  const ptyRef = useRef<PtyManager | null>(null);
  const hiddenAboveRef = useRef(0);
  const toolMsgsRef = useRef<import("./shared/types").Message[]>([]);
  const tokenBufRef = useRef("");
  const tokenCntRef = useRef(0);
  const tokenFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamInThinkingRef = useRef(false);
  const agentStartTimeRef = useRef(0);

  const [termRows, setTermRows] = useState(process.stdout.rows || 24);
  const [termCols, setTermCols] = useState(process.stdout.columns || 80);

  // Stable ref that holds the latest state values
  const s = useRef({
    agentStatus,
    isRunning: false,
    attachments,
    mode,
    pickerIdx,
    messages,
    convHistory,
    debugMode: mode === "debug",
  });
  s.current = {
    agentStatus,
    isRunning: agentStatus === "thinking" || agentStatus === "running",
    attachments,
    mode,
    pickerIdx,
    messages,
    convHistory,
    debugMode: mode === "debug",
  };

  const totalTokens =
    messages
      .filter((m) => m.type === "done" && m.tokenCount)
      .reduce((sum, m) => sum + (m.tokenCount ?? 0), 0) + tokenCount;

  const showSplash =
    messages.length === 0 &&
    agentStatus === "idle" &&
    !confirm &&
    !connectPopup &&
    !modelPicker &&
    !filePicker &&
    !infoPopup;

  // Slash-command picker: filter BUILTIN_COMMANDS when input starts with /
  const allSlashCmds = [...BUILTIN_COMMANDS, ...pluginCmds];
  const slashCmds =
    inputValue.startsWith("/") &&
    agentStatus === "idle" &&
    !showSplash &&
    !connectPopup &&
    !modelPicker
      ? allSlashCmds
          .filter((c) =>
            c.cmd.toLowerCase().startsWith(inputValue.toLowerCase()),
          )
          .slice(0, 7)
      : [];
  const showPicker = slashCmds.length > 0;

  const suggestion =
    !showSplash &&
    !showPicker &&
    !connectPopup &&
    !modelPicker &&
    agentStatus === "idle"
      ? getSuggestion(inputValue, history)
      : "";
  const isRunning = agentStatus === "thinking" || agentStatus === "running";

  useEffect(() => {
    onStatusChange?.(agentStatus, cwd);
  }, [agentStatus]);

  useEffect(() => {
    const onResize = () => {
      setTermRows(process.stdout.rows || 24);
      setTermCols(process.stdout.columns || 80);
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    try {
      ptyRef.current = new PtyManager(cwd, cm.get().shell);
    } catch {}
    return () => {
      ptyRef.current?.kill();
    };
  }, []);

  // Background update check — runs once on mount, non-blocking
  useEffect(() => {
    checkForUpdate(getAppVersion()).then((info) => {
      if (info) setUpdateInfo(info);
    });
  }, []);

  useEffect(() => {
    setPluginCmds(
      globalCommandRegistry
        .listCommands()
        .map((c) => ({ cmd: c.cmd, description: c.description })),
    );
  }, []);

  const showInfo = useCallback((title: string, lines: string[]) => {
    setInfoPopup({ title, content: lines.join("\n") });
    setInfoScroll(0);
  }, []);

  const addMsg = useCallback((msg: Omit<AgentMessage, "id" | "timestamp">) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: nextId(), timestamp: Date.now() },
    ]);
    setScrollOffset(0);
  }, []);

  const handleInputChange = useCallback(
    (v: string) => {
      const trimmed = v.trim().replace(/^["']|["']$/g, "");
      const isWindowsPath = /^[A-Za-z]:[\\\/].{2,}/.test(trimmed);
      const isUnixPath = /^\/[^\s\/]+\/[^\s]*/.test(trimmed);

      if (isWindowsPath || isUnixPath) {
        setInputValue("");
        setHistIndex(-1);
        setPickerIdx(0);
        loadAttachment(trimmed, cwd).then((att) => {
          if (att) {
            setAttachments((prev) => [...prev, att]);
          } else {
            setInputValue(v);
          }
        });
        return;
      }

      // @ triggers the file picker
      const atMatch = v.match(/(^| )@(\S*)$/)
      if (atMatch) {
        const query = atMatch[2].toLowerCase()
        listCwdFiles(cwd).then((files) => {
          const filtered = query
            ? files.filter((f) => f.toLowerCase().includes(query))
            : files
          setFileList(filtered.slice(0, 200))
          setFilePicker(true)
          setInputValue(v.slice(0, v.lastIndexOf('@')))
        })
        return
      }

      setInputValue(v);
      setHistIndex(-1);
      setPickerIdx(0);
    },
    [cwd],
  );

  const { handleSubmit } = useSlashCommands({
    cwd,
    exit,
    addMsg,
    showInfo,
    setInputValue,
    setHistIndex,
    setPickerIdx,
    setAgentStatus,
    setCurrentTokens,
    setTokenCount,
    setHistory,
    setMessages,
    setConvHistory,
    setAttachments,
    setMode,
    setConnectPopup,
    setModelPicker,
    setModelLoading,
    setModelList,
    setFilePicker,
    setFileList,
    setConfirm,
    setPluginCmds,
    setInfoScroll,
    s,
    agentRef,
    ptyRef,
    taskQueueRef,
    crashCompactRef,
    tokenBufRef,
    tokenCntRef,
    tokenFlushRef,
    toolMsgsRef,
    streamInThinkingRef,
    agentStartTimeRef,
  });

  useEffect(() => {
    if (initialCommand) {
      const t = setTimeout(() => handleSubmit(initialCommand), 150);
      return () => clearTimeout(t);
    }
  }, []);

  useInput((key, inp) => {
    // ── Wenn Popup offen: nur Ctrl+C durchlassen, Rest übernimmt Popup ──
    if (connectPopup || modelPicker || filePicker) {
      if (inp.ctrl && key === "c") {
        setConnectPopup(false);
        setModelPicker(false);
        setFilePicker(false);
      }
      return;
    }

    // ── Browse-Modus ──
    if (inp.ctrl && key === "b" && !infoPopup) {
      if (!browseMode) {
        if (toolResultMsgIds.length === 0) return;
        setBrowseMode(true);
        setFocusedToolIdx(toolResultMsgIds.length - 1);
      } else {
        setBrowseMode(false);
      }
      return;
    }
    if (browseMode) {
      if (inp.escape) {
        setBrowseMode(false);
        return;
      }
      if (inp.upArrow || inp.pageUp) {
        setFocusedToolIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (inp.downArrow || inp.pageDown) {
        setFocusedToolIdx((i) => Math.min(toolResultMsgIds.length - 1, i + 1));
        return;
      }
      if (inp.return) {
        const id = toolResultMsgIds[focusedToolIdx];
        if (id) {
          setExpandedResults((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
        return;
      }
      return;
    }

    // ── Info-Popup Navigation ──
    if (infoPopup) {
      if (inp.escape || (inp.ctrl && key === "c")) {
        setInfoPopup(null);
        setInfoScroll(0);
        return;
      }
      if (inp.upArrow) {
        setInfoScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (inp.downArrow) {
        setInfoScroll((s) => s + 1);
        return;
      }
      if (inp.pageUp) {
        setInfoScroll((s) => Math.max(0, s - 10));
        return;
      }
      if (inp.pageDown) {
        setInfoScroll((s) => s + 10);
        return;
      }
      return;
    }

    // ── Scroll (line-based) ───────────────────────────────────────────────────
    if (!showSplash && !connectPopup && !modelPicker && !filePicker) {
      if (inp.pageUp) {
        setScrollOffset((o) => o + 20);
        return;
      }
      if (inp.pageDown) {
        setScrollOffset((o) => Math.max(0, o - 20));
        return;
      }
    }

    if (!showSplash && agentStatus === "idle") {
      // ── Picker aktiv ──
      if (showPicker) {
        if (inp.upArrow) {
          setPickerIdx((i) => Math.max(0, i - 1));
          return;
        }
        if (inp.downArrow) {
          setPickerIdx((i) => Math.min(slashCmds.length - 1, i + 1));
          return;
        }
        if (inp.tab) {
          const sel = slashCmds[pickerIdx];
          if (sel) {
            setInputValue(sel.cmd.endsWith(" ") ? sel.cmd : sel.cmd.trim());
            setInputKey((k) => k + 1);
            setPickerIdx(0);
          }
          return;
        }
        if (inp.escape) {
          setInputValue("");
          setPickerIdx(0);
          setHistIndex(-1);
          return;
        }
        return;
      }

      // ── Tab cycles BUILD → PLAN → DEBUG → BUILD or Autocomplete ──
      if (inp.tab && !suggestion) {
        if (mode === "build") setMode("plan");
        else if (mode === "plan") { setMode("debug"); cm.set({ debugMode: true }); }
        else if (mode === "debug") { setMode("build"); cm.set({ debugMode: false }); }
        return;
      }
      if (inp.tab && suggestion) {
        setInputValue(inputValue + suggestion);
        return;
      }
      if (inp.upArrow) {
        if (inputValue === "" && histIndex === -1) {
          setScrollOffset((o) => o + 1);
          return;
        }
        const next = Math.min(histIndex + 1, history.length - 1);
        setHistIndex(next);
        if (history[next]) setInputValue(history[next]);
        return;
      }
      if (inp.downArrow) {
        if (inputValue === "" && histIndex === -1 && scrollOffset > 0) {
          setScrollOffset((o) => Math.max(0, o - 1));
          return;
        }
        const next = Math.max(histIndex - 1, -1);
        setHistIndex(next);
        setInputValue(next === -1 ? "" : history[next] || "");
        return;
      }
      if (inp.escape) {
        setInputValue("");
        setHistIndex(-1);
        return;
      }

      // Toggle reasoning expansion on last done message
      if (key === "r" && !inp.ctrl && !inp.meta && inputValue === "") {
        const lastDone = [...messages].reverse().find((m) => m.type === "done" && m.content);
        if (lastDone) {
          setExpandedThinking((prev) => {
            const n = new Set(prev);
            n.has(lastDone.id) ? n.delete(lastDone.id) : n.add(lastDone.id);
            return n;
          });
        }
        return;
      }
    }

    if (inp.ctrl && key === "c") {
      if (agentRef.current) {
        agentRef.current.abort();
        agentRef.current = null;
        taskQueueRef.current = [];
        if (tokenFlushRef.current) {
          clearTimeout(tokenFlushRef.current);
          tokenFlushRef.current = null;
        }
        tokenBufRef.current = "";
        tokenCntRef.current = 0;
        setAgentStatus("idle");
        setCurrentTokens("");
        addMsg({ type: "error", content: "Aborted." });
      } else {
        exit();
      }
      return;
    }

    if (inp.ctrl && key === "l") {
      setMessages([]);
      return;
    }
    if (inp.ctrl && key === "k") {
      setInputValue("");
      setHistIndex(-1);
      return;
    }

    if (confirm) {
      if (key === "y" || key === "Y") {
        agentRef.current?.confirm(true, false);
        setConfirm(null);
      } else if (key === "t" || key === "T") {
        agentRef.current?.confirm(true, true);
        setConfirm(null);
      } else if (key === "n" || key === "N" || inp.escape) {
        agentRef.current?.confirm(false, false);
        setConfirm(null);
      }
    }
  });

  const config = cm.get();
  const modeLabel = mode === "plan" ? "PLAN MODE" : mode === "debug" ? "DEBUG MODE" : "BUILD MODE";

  // ── Layout budget ────────────────────────────────────────────────────────────
  const { thinking: streamThinking } = parseThinking(currentTokens);
  const streamThinkReserve = streamThinking ? 1 : 0;
  const layoutPickerH = showPicker ? Math.min(slashCmds.length + 3, 10) : 0;
  const layoutAttachH = attachments.length > 0 ? 1 : 0;
  const layoutConfirmDiffH = confirm?.diffPreview
    ? Math.min(
        confirm.diffPreview.contextBefore.length +
          confirm.diffPreview.oldLines.length +
          confirm.diffPreview.newLines.length +
          confirm.diffPreview.contextAfter.length +
          4,
        termRows - 10,
      )
    : 0;
  const layoutConfirmH = confirm
    ? Math.min(3 + layoutConfirmDiffH, termRows - 8)
    : 0;
  const layoutInputH = 4 + layoutAttachH;
  const layoutReserved =
    layoutInputH + layoutPickerH + layoutConfirmH + 2;
  const chatAvailable = Math.max(4, termRows - layoutReserved);
  const chatInnerW = Math.max(20, termCols - 8);
  const maxStreamLines = (currentTokens || isRunning)
    ? Math.max(3, Math.min(8, Math.floor(chatAvailable / 3)))
    : 0;
  const innerStreamW = Math.max(20, termCols - 10);
  const streamH = (currentTokens || isRunning)
    ? currentTokens
      ? streamThinkReserve + 1 + maxStreamLines
      : 2
    : 0;

  return (
    <Box flexDirection="column" height={termRows}>
      {/* ── Update banner ── */}
      {updateInfo && (
        <Box justifyContent="flex-end" flexShrink={0}>
          <Text backgroundColor="#92400E" color="#FEF3C7" bold>
            {" "}↑ Update available v{updateInfo.latestVersion}{" "}
          </Text>
          <Text color="#4B5563">  </Text>
          <Text backgroundColor="#1D4ED8" color="#BFDBFE">
            {" "}{updateInfo.updateCommand}{" "}
          </Text>
        </Box>
      )}
      {showSplash ? (
        /* ── Splash ── */
        <>
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Splash
              config={config}
              history={history}
              mode={mode}
              onSubmit={handleSubmit}
              onToggleMode={() => {
                setMode((m) => {
                  if (m === "build") return "plan";
                  if (m === "plan") { cm.set({ debugMode: true }); return "debug"; }
                  cm.set({ debugMode: false }); return "build";
                });
              }}
              termRows={termRows}
            />
          </Box>
          <StatusBar
            config={config}
            cwd={cwd}
            agentStatus={agentStatus}
            tokenCount={totalTokens}
            mode={mode}
          />
        </>
      ) : (
        /* ── Chat view ── */
        <>
          <Box flexGrow={1} flexShrink={1} />

          {infoPopup ? (
            <InfoPopup
              title={infoPopup.title}
              content={infoPopup.content}
              scroll={infoScroll}
              termRows={termRows}
              termCols={termCols}
            />
          ) : null}

          {!infoPopup &&
            (() => {
              const allTurns = groupIntoTurns(messages);
              const availForTurns = Math.max(2, chatAvailable - streamH);
              const totalTurnLines = allTurns.reduce((s, t) => s + estimateTurnLines(t, chatInnerW), 0);
              const maxScroll = Math.max(0, totalTurnLines - availForTurns);
              const safeOffset = Math.min(scrollOffset, maxScroll);
              const { visible, hiddenAbove, hiddenBelow } = getVisibleTurns(
                allTurns,
                availForTurns,
                chatInnerW,
                safeOffset,
              );
              hiddenAboveRef.current = hiddenAbove;

              const renderStream = () => {
                if (!currentTokens && !isRunning) return null;
                const parsed = parseThinking(currentTokens);
                const forceThinking =
                  streamInThinkingRef.current &&
                  !currentTokens.includes("</think>") &&
                  !currentTokens.includes("</thinking>");
                const thinking = forceThinking ? currentTokens : parsed.thinking;
                const response = forceThinking ? "" : parsed.response;
                const stillThinking = forceThinking ? true : parsed.stillThinking;
                let cleanResponse = response.replace(/```json[\s\S]*?```/gi, "");
                const toolIdx = cleanResponse.search(/\{[\s\S]*?"tool"\s*:/);
                if (toolIdx !== -1) cleanResponse = cleanResponse.slice(0, toolIdx);
                cleanResponse = cleanResponse.replace(/(?:^|\n)DONE:\s*/gi, "\n").trim();

                const srcLines = cleanResponse.split("\n");
                const rendered: string[] = [];
                for (const l of srcLines) {
                  if (!l) { rendered.push(""); continue; }
                  const chunks = Math.max(1, Math.ceil(l.length / innerStreamW));
                  for (let c = 0; c < chunks; c++)
                    rendered.push(l.slice(c * innerStreamW, (c + 1) * innerStreamW));
                }
                const overflow = Math.max(0, rendered.length - maxStreamLines);
                const visibleLines = rendered.slice(overflow);
                const thinkClean = (() => {
                  let t = thinking.trim();
                  const toolIdx = t.search(/\{[^}]*"tool"\s*:/);
                  if (toolIdx !== -1) t = t.slice(0, toolIdx);
                  return t;
                })();
                const thinkOneLine = thinkClean.replace(/\s+/g, " ").trim();

                return (
                  <Box flexDirection="column">
                    {thinking && (
                      <Box>
                        <Text color="#3B82F6"> │ </Text>
                        <Text color="#6366F1" bold>Reasoning{" "}</Text>
                        {stillThinking && <ThinkingDots label="" />}
                        {thinkOneLine ? (
                          <Text color="#4B5563" dimColor italic wrap="truncate-start">
                            {thinkOneLine}
                          </Text>
                        ) : null}
                      </Box>
                    )}
                    {overflow > 0 && (
                      <Box>
                        <Text color="#3B82F6"> │ </Text>
                        <Text color="#4B5563">↑ {overflow} lines above…</Text>
                      </Box>
                    )}
                    {!currentTokens ? (
                      <Box>
                        <Text color="#3B82F6"> │ </Text>
                        <Box flexGrow={1}>
                          <Text color="#6366F1">Thinking </Text>
                          <ThinkingDots label="" />
                        </Box>
                      </Box>
                    ) : visibleLines.length > 0 ? (
                      visibleLines.map((line, i) => (
                        <Box key={i}>
                          <Text color="#3B82F6"> │ </Text>
                          <Text color="#D1D5DB" wrap="truncate-end">{line || " "}</Text>
                          {i === visibleLines.length - 1 && <Text color="#3B82F6">█</Text>}
                        </Box>
                      ))
                    ) : stillThinking ? (
                      <Box>
                        <Text color="#3B82F6"> │ </Text>
                        <Box flexGrow={1}>
                          <Text color="#6366F1">Thinking </Text>
                          <ThinkingDots label="" />
                        </Box>
                      </Box>
                    ) : null}
                  </Box>
                );
              };

              return (
                <>
                  {hiddenAbove > 0 ? (
                    <Box paddingX={1}>
                      <Text color="#F59E0B">↑ PgUp  </Text>
                      <Text color="#6B7280">{hiddenAbove} older {hiddenAbove === 1 ? 'message' : 'messages'} above</Text>
                    </Box>
                  ) : (
                    <Text> </Text>
                  )}

                  {visible.map((turn, i) =>
                    turn.type === "user" ? (
                      <UserBlock
                        key={i}
                        content={turn.content}
                        timestamp={turn.timestamp}
                      />
                    ) : (
                      <AgentBlock
                        key={i}
                        messages={turn.messages}
                        model={config.llm.model}
                        maxLines={
                          i === visible.length - 1 && safeOffset === 0
                            ? Math.max(5, availForTurns - 4)
                            : undefined
                        }
                        debugMode={mode === "debug"}
                        expandedResults={expandedResults}
                        focusedToolId={focusedToolId}
                        expandedThinking={expandedThinking}
                        onToggleThinking={(id) => setExpandedThinking((prev) => {
                          const n = new Set(prev);
                          n.has(id) ? n.delete(id) : n.add(id);
                          return n;
                        })}
                      />
                    ),
                  )}

                  {renderStream()}
                </>
              );
            })()}

          {/* Confirm dialog */}
          {confirm && (
            <Box
              flexDirection="column"
              marginX={1}
              marginBottom={1}
              borderStyle="single"
              borderColor={confirm.dangerous ? "#EF4444" : "#F59E0B"}
            >
              {confirm.dangerous && (
                <Box paddingX={2} paddingTop={0}>
                  <Text backgroundColor="#7F1D1D" color="#FCA5A5" bold>
                    {" "}
                    ⚠ DANGEROUS OPERATION — review carefully{" "}
                  </Text>
                </Box>
              )}
              {confirm.diffPreview && (
                <DiffView
                  filePath={confirm.diffPreview.filePath}
                  oldLines={confirm.diffPreview.oldLines}
                  newLines={confirm.diffPreview.newLines}
                  startLine={confirm.diffPreview.startLine}
                  contextBefore={confirm.diffPreview.contextBefore}
                  contextAfter={confirm.diffPreview.contextAfter}
                />
              )}
              <Box paddingX={2} paddingY={0} flexDirection="column">
                <Box>
                  <Text color={confirm.dangerous ? "#EF4444" : "#F59E0B"}>
                    {confirm.dangerous ? "⚠  " : "Allow  "}
                  </Text>
                  <Text color="#D1D5DB" wrap="truncate-end">
                    {confirm.reason}
                  </Text>
                </Box>
                <Box marginTop={0}>
                  <Text color="#22C55E">[y] yes</Text>
                  <Text color="#4B5563"> / </Text>
                  <Text color="#EF4444">[n] no</Text>
                  {!confirm.dangerous && (
                    <>
                      <Text color="#4B5563"> / </Text>
                      <Text color="#A78BFA">[t] trust folder</Text>
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* ── Connect Popup ── */}
          {connectPopup && (
            <ConnectPopup
              onConnect={(provider, baseURL) => {
                cm.setLLM({ provider: provider as any, baseURL });
                setConnectPopup(false);
                addMsg({
                  type: "done",
                  content: `Connected · ${provider}  ${baseURL}`,
                });
              }}
              onCancel={() => setConnectPopup(false)}
            />
          )}

          {/* ── Model Picker ── */}
          {modelPicker && (
            <ModelPicker
              models={modelList}
              loading={modelLoading}
              currentModel={config.llm.model}
              onSelect={(model) => {
                cm.setLLM({ model });
                setModelPicker(false);
                addMsg({ type: "done", content: `Model → ${model}` });
              }}
              onCancel={() => setModelPicker(false)}
            />
          )}

          {/* ── FilePicker ── */}
          {filePicker && (
            <FilePicker
              files={fileList}
              onSelect={async (path) => {
                setFilePicker(false);
                const att = await loadAttachment(path, cwd);
                if (att) setAttachments((prev) => [...prev, att]);
              }}
              onCancel={() => setFilePicker(false)}
            />
          )}

          {/* ── Slash-Command Picker ── */}
          {showPicker && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor="#2D4A7A"
              marginX={1}
            >
              {slashCmds.map((cmd, i) => {
                const sel = i === pickerIdx;
                return (
                  <Box key={cmd.cmd} paddingX={1}>
                    <Text color={sel ? "#3B82F6" : "#374151"}>
                      {sel ? "▶ " : "  "}
                    </Text>
                    <Text color={sel ? "#60A5FA" : "#6B7280"} bold>
                      {cmd.cmd.trimEnd()}
                    </Text>
                    <Text color={sel ? "#4B5563" : "#374151"}>
                      {" "}
                      {cmd.description}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}

          {/* ── Input box ── */}
          {!infoPopup && (
            <Box
              flexShrink={0}
              flexDirection="column"
              borderStyle="single"
              borderColor={mode === "plan" ? "#14532D" : mode === "debug" ? "#581C87" : "#1E3A5F"}
              marginX={1}
            >
              {/* Attachment strip */}
              {attachments.length > 0 && (
                <Box paddingX={1} flexDirection="row">
                  {attachments.map((att, i) => (
                    <Box key={i} marginRight={1}>
                      <Text
                        color={att.type === "image" ? "#A78BFA" : "#60A5FA"}
                      >
                        @{att.name}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Input row */}
              <Box paddingX={1}>
                <Text
                  color={
                    isRunning
                      ? "#F59E0B"
                      : mode === "plan"
                        ? "#22C55E"
                        : mode === "debug"
                          ? "#A78BFA"
                          : "#3B82F6"
                  }
                  bold
                >
                  {"> "}
                </Text>
                <TextInput
                  key={inputKey}
                  value={inputValue}
                  onChange={handleInputChange}
                  onSubmit={handleSubmit}
                  placeholder={
                    isRunning
                      ? "inject message to agent..."
                      : mode === "plan"
                        ? "describe what to plan..."
                        : "/ for commands  ·  @ to attach files"
                  }
                  focus={
                    !confirm && !connectPopup && !modelPicker && !filePicker && !browseMode
                  }
                />
                {suggestion && !isRunning && (
                  <Text color="#1F2937">{suggestion}</Text>
                )}
              </Box>

              {/* Hint bar */}
              <Box paddingX={1}>
                <Box flexGrow={1}>
                  {isRunning ? (
                    <>
                      <Text color="#F59E0B">ctrl+c </Text>
                      <Text color="#6B7280">abort </Text>
                      <Text color="#4B5563">↵ </Text>
                      <Text color="#6B7280">inject message</Text>
                    </>
                  ) : browseMode ? (
                    <>
                      <Text color="#3B82F6">↑↓ </Text>
                      <Text color="#6B7280">navigate </Text>
                      <Text color="#3B82F6">↵ </Text>
                      <Text color="#6B7280">expand/collapse </Text>
                      <Text color="#3B82F6">esc </Text>
                      <Text color="#6B7280">exit browse</Text>
                    </>
                  ) : (
                    <>
                      <Text color="#4B5563">↵ </Text>
                      <Text color="#6B7280">send </Text>
                      <Text color="#4B5563">tab </Text>
                      <Text color="#6B7280">
                        {suggestion ? "complete" : mode === "build" ? "→plan" : mode === "plan" ? "→debug" : "→build"}{" "}
                      </Text>
                      <Text color="#4B5563">@ </Text>
                      <Text color="#6B7280">attach</Text>
                      {toolResultMsgIds.length > 0 && (
                        <>
                          <Text color="#4B5563"> │ </Text>
                          <Text color="#4B5563">ctrl+b </Text>
                          <Text color="#6B7280">expand</Text>
                        </>
                      )}
                    </>
                  )}
                </Box>
                <Box>
                  <Text
                    backgroundColor={
                      mode === "plan" ? "#166534" : mode === "debug" ? "#7C3AED" : "#1D4ED8"
                    }
                    color={
                      mode === "plan" ? "#86EFAC" : mode === "debug" ? "#EDE9FE" : "#BFDBFE"
                    }
                  >
                    {" "}
                    {mode === "plan" ? "PLAN" : mode === "debug" ? "DEBUG" : "BUILD"}{" "}
                  </Text>
                  <Text color="#374151"> </Text>
                  <Text color="#9CA3AF">
                    {config.llm.model.length > 24
                      ? config.llm.model.slice(0, 24) + "…"
                      : config.llm.model}
                  </Text>
                  {config.llm.provider === "llamacpp" && (
                    <Text color="#6B7280">
                      {" "}
                      · ctx {extractContextSize(config.llamaCppServer?.extraArgs) ?? "default"}
                    </Text>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* Status bar */}
          <Box flexShrink={0}>
            <StatusBar
              config={config}
              cwd={cwd}
              agentStatus={agentStatus}
              tokenCount={totalTokens}
              mode={mode}
            />
          </Box>
        </>
      )}
    </Box>
  );
};
