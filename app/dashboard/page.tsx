"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import api from "../../lib/api";
import { useRouter } from "next/navigation";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Source {
  document_id?: number;
  document_title?: string;
  page?: number;
  chunk?: number;
  text?: string;
  score?: number;
}

interface Message {
  role: "user" | "ai";
  content: string;
  timestamp: number;
  id: string;
  sources?: Source[];
  isGlobal?: boolean;
}

interface AnalysisResult {
  insights?: string;
  error?: string;
  summary?: string;
  word_count?: number;
  page_count?: number;
}

interface Document {
  id: number;
  title: string;
  status: "pending" | "processing" | "completed" | "failed";
  analysis_result?: AnalysisResult;
  created_at?: string;
  file_size?: number;
  updated_at?: string;
}

interface UploadProgress {
  percent: number;
  uploading: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POLLING_INTERVAL = 4000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const API_TIMEOUT = 60000;
const ALLOWED_FILE_TYPE = "application/pdf";

const STATUS_CONFIG = {
  pending: { color: "yellow", label: "Pending" },
  processing: { color: "blue", label: "Processing" },
  completed: { color: "green", label: "Ready" },
  failed: { color: "red", label: "Failed" }
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "Unknown size";
  const kb = bytes / 1024;
  const mb = kb / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
};

const formatTimestamp = (timestamp?: string): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const getStatusStyle = (status: Document["status"]) => {
  const config = STATUS_CONFIG[status];
  return {
    dotColor: `bg-${config.color}-500`,
    textColor: `text-${config.color}-400`,
    borderColor: `border-${config.color}-500/30`,
    bgColor: `bg-${config.color}-500/10`
  };
};

const formatSources = (sources?: Source[]): string => {
  if (!sources || sources.length === 0) return "";
  const hasPages = sources.some(s => s.page !== undefined);
  if (hasPages) {
    const pageNumbers = sources
      .map(s => s.page)
      .filter((page): page is number => page !== undefined)
      .filter((page, index, self) => self.indexOf(page) === index)
      .sort((a, b) => a - b);
    if (pageNumbers.length === 0) return "";
    return `Page${pageNumbers.length > 1 ? 's' : ''} ${pageNumbers.join(", ")}`;
  }
  return `${sources.length} sources`;
};

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

const useDocumentPolling = (fetchDocs: () => Promise<void>, documents: Document[]) => {
  useEffect(() => {
    const hasProcessingDocs = documents.some(d => d.status === "processing" || d.status === "pending");
    if (!hasProcessingDocs) return;
    const interval = setInterval(fetchDocs, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [documents, fetchDocs]);
};

const useAutoScroll = (dependency: any[]) => {
  const elementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    elementRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dependency]);
  return elementRef;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Dashboard() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDoc, setActiveDoc] = useState<Document | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [globalMessages, setGlobalMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [globalInput, setGlobalInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ percent: 0, uploading: false });
  const [error, setError] = useState<string | null>(null);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useAutoScroll([messages]);
  const globalMessagesEndRef = useAutoScroll([globalMessages]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ============================================================================
  // AUTH CHECK
  // ============================================================================
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
    } else {
      setIsAuthenticated(true);
    }
  }, [router]);

  // ============================================================================
  // FETCH DOCUMENTS
  // ============================================================================
  const fetchDocs = useCallback(async () => {
    try {
      const response = await api.get("/documents/", { timeout: API_TIMEOUT });
      const data = response.data.results || response.data;
      setDocuments(data);
      setActiveDoc(prev => {
        if (!prev) return null;
        const updated = data.find((d: Document) => d.id === prev.id);
        return updated || prev;
      });
    } catch (err: any) {
      console.error("Fetch error:", err);
      if (err.response?.status === 401) {
        setError("Session expired. Please login again.");
        localStorage.clear();
        router.push('/login');
      }
    } finally {
      setIsLoadingDocs(false);
    }
  }, [router]);

  useEffect(() => { 
    if (isAuthenticated) {
      fetchDocs(); 
    }
  }, [fetchDocs, isAuthenticated]);
  
  useDocumentPolling(fetchDocs, documents);

  // ============================================================================
  // HANDLE UPLOAD
  // ============================================================================
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.type !== ALLOWED_FILE_TYPE) {
      setError("Only PDF files are allowed");
      return;
    }
    
    if (file.size > MAX_FILE_SIZE) {
      setError("File size exceeds 10MB limit");
      return;
    }
    
    setUploadProgress({ percent: 0, uploading: true });
    setError(null);
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name);
    
    try {
      await api.post("/documents/", formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress({ percent, uploading: true });
        }
      });
      
      setSuccessMessage("File uploaded successfully!");
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchDocs();
      
    } catch (err: any) { 
      console.error("Upload error:", err);
      setError(err.response?.data?.detail || err.response?.data?.file?.[0] || "Upload failed"); 
    } finally { 
      setUploadProgress({ percent: 0, uploading: false }); 
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // ============================================================================
  // START ANALYSIS
  // ============================================================================
  const startAnalysis = async (doc: Document) => {
    try {
      await api.post(`/documents/${doc.id}/analyze/`);
      setSuccessMessage("Analysis started!");
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchDocs();
    } catch (err: any) { 
      console.error("Analysis error:", err);
      setError(err.response?.data?.detail || err.response?.data?.message || "Analysis failed"); 
    }
  };

  // ============================================================================
  // HANDLE DELETE
  // ============================================================================
  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    
    try {
      await api.delete(`/documents/${doc.id}/`);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      if (activeDoc?.id === doc.id) {
        setActiveDoc(null);
        setMessages([]);
      }
      setSuccessMessage("Document deleted successfully!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) { 
      console.error("Delete error:", err);
      setError(err.response?.data?.detail || "Delete failed"); 
    }
  };

  // ============================================================================
  // HANDLE ASK
  // ============================================================================
  const handleAsk = async (e: React.FormEvent, type: "global" | "specific" = "specific") => {
    e.preventDefault();
    const isGlobal = type === "global";
    const text = isGlobal ? globalInput : input;
    
    if (!text.trim()) return;

    const userMsg: Message = { 
      role: "user", 
      content: text, 
      timestamp: Date.now(), 
      id: generateMessageId(), 
      isGlobal 
    };
    
    if (isGlobal) {
      setGlobalMessages(prev => [...prev, userMsg]);
      setGlobalInput("");
    } else {
      setMessages(prev => [...prev, userMsg]);
      setInput("");
    }

    setIsAsking(true);
    
    try {
      const url = isGlobal ? "/documents/global_ask/" : `/documents/${activeDoc?.id}/ask/`;
      const res = await api.post(url, { question: text });
      
      const aiMsg: Message = {
        role: "ai",
        content: res.data.answer,
        timestamp: Date.now(),
        id: generateMessageId(),
        sources: res.data.sources,
        isGlobal
      };
      
      if (isGlobal) {
        setGlobalMessages(prev => [...prev, aiMsg]);
      } else {
        setMessages(prev => [...prev, aiMsg]);
      }
        
    } catch (err: any) {
      console.error("AI error:", err);
      const errorContent = err.response?.data?.error || err.response?.data?.detail || "Sorry, I couldn't process your question. Please try again.";
      
      const errorMsg: Message = {
        role: "ai",
        content: errorContent,
        timestamp: Date.now(),
        id: generateMessageId(),
        isGlobal
      };
      
      if (isGlobal) {
        setGlobalMessages(prev => [...prev, errorMsg]);
      } else {
        setMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      setIsAsking(false);
    }
  };

  // ============================================================================
  // HANDLE LOGOUT
  // ============================================================================
  const handleLogout = () => { 
    localStorage.clear(); 
    router.push("/login"); 
  };

  // ============================================================================
  // FILTERED DOCUMENTS
  // ============================================================================
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => 
      doc.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [documents, searchQuery]);

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  if (!isAuthenticated || (isLoadingDocs && documents.length === 0)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex h-screen bg-gray-950 text-white font-sans overflow-hidden">
      {/* Success/Error Notifications */}
      {successMessage && (
        <div className="fixed top-4 right-4 z-50 bg-green-500/90 backdrop-blur-sm text-white px-6 py-3 rounded-xl shadow-2xl animate-in slide-in-from-top">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            {successMessage}
          </div>
        </div>
      )}
      
      {error && (
        <div className="fixed top-4 right-4 z-50 bg-red-500/90 backdrop-blur-sm text-white px-6 py-3 rounded-xl shadow-2xl animate-in slide-in-from-top">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {error}
            <button onClick={() => setError(null)} className="ml-2 hover:text-gray-200">×</button>
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col transition-all duration-500 ${activeDoc ? "mr-[500px]" : ""}`}>
        {/* HEADER */}
        <header className="flex-shrink-0 px-8 py-6 border-b border-gray-800/50 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Smart<span className="text-blue-500">Doc</span></h1>
            <p className="text-xs text-gray-500 mt-1">Enterprise Document Intelligence</p>
          </div>
          <button 
            onClick={handleLogout} 
            className="px-4 py-2 border border-gray-800 rounded-lg hover:bg-gray-900 transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </header>

        {/* MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* GLOBAL SEARCH SECTION */}
            {!activeDoc && (
              <div className="bg-gray-900/40 border border-blue-500/20 rounded-2xl flex flex-col h-[450px] shadow-2xl overflow-hidden">
                <div className="px-6 py-3 border-b border-blue-500/10 flex items-center justify-between">
                  <h2 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Global Intelligence Search</h2>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">
                    {documents.filter(d => d.status === 'completed').length} Documents
                  </span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {globalMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <svg className="w-16 h-16 text-blue-500/20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p className="text-gray-500 text-sm">Ask a question across all your documents</p>
                      <p className="text-gray-600 text-xs mt-2">Upload and analyze documents to get started</p>
                    </div>
                  ) : (
                    globalMessages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-800/80 border border-gray-700'}`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-2 text-[10px] text-gray-400 border-t border-gray-700 pt-2">
                              📚 Found in: {msg.sources.map(s => s.document_title).filter(Boolean).join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={globalMessagesEndRef} />
                </div>
                
                <form onSubmit={(e) => handleAsk(e, "global")} className="p-4 bg-gray-950/30 border-t border-gray-800">
                  <div className="flex gap-2">
                    <input 
                      value={globalInput}
                      onChange={(e) => setGlobalInput(e.target.value)}
                      placeholder="Ask a question across all your documents..." 
                      className="flex-1 bg-gray-800 border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                      disabled={isAsking || documents.filter(d => d.status === 'completed').length === 0}
                    />
                    <button 
                      type="submit" 
                      disabled={isAsking || !globalInput.trim() || documents.filter(d => d.status === 'completed').length === 0} 
                      className="bg-blue-600 hover:bg-blue-500 px-6 rounded-xl font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isAsking ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Thinking...
                        </>
                      ) : (
                        <>
                          Ask All
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* UPLOAD PANEL */}
              <div className="lg:col-span-1 bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <h2 className="text-sm font-bold text-gray-400 mb-4 uppercase flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Upload
                </h2>
                <div className="relative border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:border-blue-500 transition cursor-pointer group">
                  <input 
                    ref={fileInputRef} 
                    type="file" 
                    accept=".pdf"
                    onChange={handleUpload} 
                    className="absolute inset-0 opacity-0 cursor-pointer" 
                    disabled={uploadProgress.uploading}
                  />
                  {uploadProgress.uploading ? (
                    <div className="space-y-3">
                      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <p className="text-sm text-blue-500 font-semibold">Uploading {uploadProgress.percent}%</p>
                      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-blue-500 h-full transition-all duration-300"
                          style={{ width: `${uploadProgress.percent}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <svg className="w-12 h-12 mx-auto mb-3 text-gray-600 group-hover:text-blue-500 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm text-gray-500 group-hover:text-gray-400">Drop PDF or Click to Browse</p>
                      <p className="text-xs text-gray-600 mt-2">Max 10MB</p>
                    </>
                  )}
                </div>
              </div>

              {/* LIBRARY PANEL */}
              <div className="lg:col-span-2 bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-bold text-gray-400 uppercase flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Library ({documents.length})
                  </h2>
                  <input 
                    value={searchQuery} 
                    onChange={(e) => setSearchQuery(e.target.value)} 
                    placeholder="Filter documents..." 
                    className="bg-gray-800 text-xs px-3 py-1.5 rounded-lg border border-gray-700 outline-none focus:border-blue-500 transition" 
                  />
                </div>
                
                {documents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <svg className="w-16 h-16 text-gray-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 text-sm">No documents yet</p>
                    <p className="text-gray-600 text-xs mt-2">Upload a PDF to get started</p>
                  </div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <p className="text-gray-500 text-sm">No documents match "{searchQuery}"</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredDocuments.map(doc => (
                      <div 
                        key={doc.id} 
                        className={`p-4 rounded-xl border transition ${
                          activeDoc?.id === doc.id 
                            ? 'bg-blue-500/10 border-blue-500/50' 
                            : 'bg-gray-800/30 border-gray-800/50 hover:bg-gray-800/50'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold truncate">{doc.title}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] font-bold uppercase ${getStatusStyle(doc.status).textColor} flex items-center gap-1`}>
                                <span className={`w-2 h-2 rounded-full ${getStatusStyle(doc.status).dotColor} animate-pulse`}></span>
                                {doc.status}
                              </span>
                              {doc.created_at && (
                                <span className="text-[10px] text-gray-600">
                                  {formatTimestamp(doc.created_at)}
                                </span>
                              )}
                            </div>
                            {doc.status === "completed" && doc.analysis_result?.insights && (
                              <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                                {doc.analysis_result.insights.split('\n')[0]}
                              </p>
                            )}
                          </div>
                          
                          <div className="flex gap-2 ml-4">
                            {doc.status === "pending" && (
                              <button 
                                onClick={() => startAnalysis(doc)} 
                                className="bg-blue-600 hover:bg-blue-500 text-[10px] px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap"
                              >
                                Analyze
                              </button>
                            )}
                            {doc.status === "completed" && (
                              <button 
                                onClick={() => { 
                                  setActiveDoc(doc); 
                                  setMessages([]); 
                                }} 
                                className="bg-green-600 hover:bg-green-500 text-[10px] px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap"
                              >
                                Open Chat
                              </button>
                            )}
                            <button 
                              onClick={() => handleDelete(doc)} 
                              className="text-gray-600 hover:text-red-500 transition p-1"
                              title="Delete document"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* SIDEBAR CHAT (SPECIFIC DOC) */}
      {activeDoc && (
        <aside className="w-[500px] bg-gray-900 border-l border-gray-800 fixed right-0 h-full flex flex-col animate-in slide-in-from-right">
          <div className="p-6 border-b border-gray-800 flex justify-between items-center">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold truncate">{activeDoc.title}</h3>
              <span className={`text-[10px] font-bold uppercase ${getStatusStyle(activeDoc.status).textColor}`}>
                {activeDoc.status}
              </span>
            </div>
            <button 
              onClick={() => {
                setActiveDoc(null);
                setMessages([]);
              }} 
              className="text-gray-500 hover:text-white transition ml-4"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <svg className="w-16 h-16 text-blue-500/20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-gray-500 text-sm">Start asking questions about this document</p>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-xl ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-800 border border-gray-700'}`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-700">
                        <p className="text-[10px] text-blue-400 font-bold">
                          📖 {formatSources(msg.sources)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <form onSubmit={(e) => handleAsk(e, "specific")} className="p-6 border-t border-gray-800">
            <div className="flex gap-2">
              <input 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder="Ask about this document..." 
                className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700"
                disabled={isAsking}
              />
              <button 
                type="submit" 
                disabled={isAsking || !input.trim()} 
                className="bg-blue-600 hover:bg-blue-500 p-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAsking ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </aside>
      )}

      {/* Custom Scrollbar Styles */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgb(31 41 55 / 0.3);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgb(75 85 99 / 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgb(107 114 128 / 0.7);
        }
      `}</style>
    </div>
  );
}