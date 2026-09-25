import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Database,
  Trash2,
  Download,
  Upload,
  UserCheck,
  Clock,
  Eye,
  ShieldCheck,
  AlertTriangle,
  FileText,
  UserPlus,
  Edit3,
  Check,
  Search,
  Tag,
  Briefcase,
  Sparkles,
  Camera,
  Image as ImageIcon,
} from 'lucide-react';
import { IdentityProfile, FaceSighting } from '../types';
import { idb } from '../identity/indexedDb';
import * as faceapi from '@vladmandic/face-api';

interface IdentityMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  identities: IdentityProfile[];
  onRefreshIdentities: () => void;
  onOpenEnrollment: () => void;
}

export const IdentityMemoryModal: React.FC<IdentityMemoryModalProps> = ({
  isOpen,
  onClose,
  identities,
  onRefreshIdentities,
  onOpenEnrollment,
}) => {
  const [activeTab, setActiveTab] = useState<'profiles' | 'add' | 'sightings'>('profiles');
  const [sightings, setSightings] = useState<FaceSighting[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // In-modal confirmation state for deletion (replaces native window.confirm)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);
  const [confirmClearSightings, setConfirmClearSightings] = useState<boolean>(false);

  // Edit Identity State
  const [editingIdentity, setEditingIdentity] = useState<IdentityProfile | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editRole, setEditRole] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editTags, setEditTags] = useState<string>('');

  // Add Custom Identity State
  const [addName, setAddName] = useState<string>('');
  const [addRole, setAddRole] = useState<string>('');
  const [addNotes, setAddNotes] = useState<string>('');
  const [addTags, setAddTags] = useState<string>('');
  const [addPhotoUrl, setAddPhotoUrl] = useState<string | null>(null);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState<boolean>(false);
  const [isSavingCustom, setIsSavingCustom] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen && activeTab === 'sightings') {
      idb.getSightings(200).then(setSightings);
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // Filtered identities for display
  const filteredProfiles = identities.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = p.name.toLowerCase().includes(q);
    const roleMatch = (p.role || p.metadata?.role || '').toLowerCase().includes(q);
    const notesMatch = (p.notes || p.metadata?.notes || '').toLowerCase().includes(q);
    const tagsMatch = (p.tags || p.metadata?.tags || []).some((t) => t.toLowerCase().includes(q));
    return nameMatch || roleMatch || notesMatch || tagsMatch;
  });

  // Handle Delete Identity
  const handleDeleteIdentity = async (id: string) => {
    try {
      await idb.deleteIdentity(id);
      setConfirmDeleteId(null);
      setStatusMessage({ type: 'success', text: 'Identity removed from local memory.' });
      onRefreshIdentities();
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Failed to delete identity.' });
    }
  };

  // Handle Delete Sighting
  const handleDeleteSighting = async (id: string) => {
    try {
      await idb.deleteSighting(id);
      setSightings((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.warn('Failed to delete sighting:', err);
    }
  };

  // Open Edit Form
  const handleOpenEdit = (profile: IdentityProfile) => {
    setEditingIdentity(profile);
    setEditName(profile.name);
    setEditRole(profile.role || profile.metadata?.role || '');
    setEditNotes(profile.notes || profile.metadata?.notes || '');
    setEditTags((profile.tags || profile.metadata?.tags || []).join(', '));
  };

  // Save Edited Identity
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIdentity || !editName.trim()) return;

    const parsedTags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const updatedProfile: Partial<IdentityProfile> = {
      name: editName.trim(),
      role: editRole.trim() || undefined,
      notes: editNotes.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      metadata: {
        ...editingIdentity.metadata,
        notes: editNotes.trim() || undefined,
        role: editRole.trim() || undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
      },
    };

    try {
      await idb.updateIdentity(editingIdentity.id, updatedProfile);
      setEditingIdentity(null);
      setStatusMessage({ type: 'success', text: `Identity "${editName.trim()}" updated successfully.` });
      onRefreshIdentities();
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Failed to update identity.' });
    }
  };

  // Handle Photo Upload for Add Custom Identity
  const handleCustomPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingPhoto(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      setAddPhotoUrl(dataUrl);
      setIsProcessingPhoto(false);
    };
    reader.readAsDataURL(file);
  };

  // Save New Custom Identity
  const handleSaveCustomIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) {
      setStatusMessage({ type: 'error', text: 'Please provide an identity name.' });
      return;
    }

    setIsSavingCustom(true);
    try {
      let descriptorArray: number[] = [];

      // If a photo was uploaded, attempt to extract face descriptor using faceapi
      if (addPhotoUrl) {
        try {
          const img = new Image();
          img.src = addPhotoUrl;
          await new Promise((resolve) => {
            img.onload = resolve;
          });

          if (faceapi.nets.faceRecognitionNet.isLoaded && faceapi.nets.faceLandmark68Net.isLoaded) {
            const detection = await faceapi
              .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
              .withFaceLandmarks()
              .withFaceDescriptor();

            if (detection?.descriptor) {
              descriptorArray = Array.from(detection.descriptor);
            }
          }
        } catch (photoErr) {
          console.warn('Descriptor extraction from photo skipped:', photoErr);
        }
      }

      // If no descriptor extracted from image, generate a clean 128-d zero vector placeholder
      if (descriptorArray.length === 0) {
        descriptorArray = new Array(128).fill(0).map(() => (Math.random() - 0.5) * 0.05);
      }

      const parsedTags = addTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const newId = `id_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const newProfile: IdentityProfile = {
        id: newId,
        name: addName.trim(),
        role: addRole.trim() || undefined,
        notes: addNotes.trim() || undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
        embeddings: [descriptorArray],
        thumbnail: addPhotoUrl || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sampleCount: 1,
        metadata: {
          notes: addNotes.trim() || undefined,
          role: addRole.trim() || undefined,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        },
      };

      await idb.saveIdentity(newProfile);

      // Reset form
      setAddName('');
      setAddRole('');
      setAddNotes('');
      setAddTags('');
      setAddPhotoUrl(null);
      setActiveTab('profiles');
      setStatusMessage({ type: 'success', text: `Profile for "${newProfile.name}" created successfully!` });
      onRefreshIdentities();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Failed to save custom identity.' });
    } finally {
      setIsSavingCustom(false);
    }
  };

  // Clear All Identities & Sightings
  const handleExecuteClearAll = async () => {
    await idb.clearAllIdentities();
    await idb.clearSightings();
    setSightings([]);
    setConfirmClearAll(false);
    setStatusMessage({ type: 'success', text: 'All local identities and logs cleared.' });
    onRefreshIdentities();
  };

  // Clear Sightings only
  const handleExecuteClearSightings = async () => {
    await idb.clearSightings();
    setSightings([]);
    setConfirmClearSightings(false);
    setStatusMessage({ type: 'success', text: 'Sighting logs cleared.' });
  };

  // Export JSON
  const handleExportJSON = async () => {
    setIsExporting(true);
    try {
      const dataStr = await idb.exportAllData();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-face-intelligence-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMessage({ type: 'success', text: 'Database exported successfully.' });
    } finally {
      setIsExporting(false);
    }
  };

  // Import JSON
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const success = await idb.importData(text);
        if (success) {
          setStatusMessage({ type: 'success', text: 'Identities imported successfully!' });
          onRefreshIdentities();
        } else {
          setStatusMessage({ type: 'error', text: 'Import failed: Invalid data format.' });
        }
      } catch {
        setStatusMessage({ type: 'error', text: 'Error reading import file.' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col font-mono max-h-[88vh]">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                Biometric Memory & Identity Manager
              </h3>
              <p className="text-[11px] text-zinc-400">
                IndexedDB Persistent Storage &bull; Fully Local Subsystem
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJSON}
              disabled={isExporting}
              title="Export database as JSON"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            <label
              title="Import JSON backup"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
            </label>

            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-all ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-950 border-b border-zinc-800/80 text-xs">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('profiles')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                activeTab === 'profiles'
                  ? 'bg-emerald-500 text-black font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Enrolled Profiles ({identities.length})
            </button>
            <button
              onClick={() => setActiveTab('add')}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'add'
                  ? 'bg-cyan-500 text-black font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Custom</span>
            </button>
            <button
              onClick={() => setActiveTab('sightings')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                activeTab === 'sightings'
                  ? 'bg-emerald-500 text-black font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sighting Logs ({sightings.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenEnrollment}
              className="text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 px-2.5 py-1 rounded-md flex items-center gap-1 transition-all"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Camera Wizard</span>
            </button>
          </div>
        </div>

        {/* Toast / Status Message */}
        {statusMessage && (
          <div
            className={`text-xs px-4 py-2 flex items-center justify-between border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/15 border-red-500/30 text-red-300'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button onClick={() => setStatusMessage(null)} className="text-zinc-400 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
          {/* TAB 1: PROFILES */}
          {activeTab === 'profiles' && (
            <>
              {/* Search filter for profiles */}
              {identities.length > 0 && (
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search enrolled profiles by name, role, tags, or notes..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {identities.length === 0 ? (
                <div className="text-center py-12 flex flex-col items-center gap-3 text-zinc-500 text-xs">
                  <UserCheck className="w-10 h-10 text-zinc-600" />
                  <p className="text-zinc-300 font-semibold">No identities stored in local memory yet.</p>
                  <p className="text-[11px] text-zinc-500 max-w-sm">
                    Add custom profiles manually using <strong>+ Add Custom</strong> or launch the <strong>Camera Wizard</strong> to enroll live faces.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setActiveTab('add')}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500 text-black font-bold text-xs flex items-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Custom Identity</span>
                    </button>
                    <button
                      onClick={onOpenEnrollment}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black font-bold text-xs flex items-center gap-1.5"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Camera Wizard</span>
                    </button>
                  </div>
                </div>
              ) : filteredProfiles.length === 0 ? (
                <div className="text-center py-8 text-xs text-zinc-500">
                  No identities matching "{searchQuery}".
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredProfiles.map((profile) => {
                    const isConfirmingDelete = confirmDeleteId === profile.id;
                    const role = profile.role || profile.metadata?.role;
                    const notes = profile.notes || profile.metadata?.notes;
                    const tags = profile.tags || profile.metadata?.tags || [];

                    return (
                      <div
                        key={profile.id}
                        className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800/90 flex flex-col justify-between gap-3 hover:border-zinc-700 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          {profile.thumbnail ? (
                            <img
                              src={profile.thumbnail}
                              alt={profile.name}
                              className="w-12 h-12 rounded-lg border border-zinc-700 object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 font-bold shrink-0 text-sm">
                              {profile.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-zinc-100 truncate">
                                {profile.name}
                              </h4>
                            </div>

                            {role && (
                              <div className="text-[11px] text-cyan-400 flex items-center gap-1 mt-0.5">
                                <Briefcase className="w-3 h-3" />
                                <span className="truncate">{role}</span>
                              </div>
                            )}

                            <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-1">
                              <span className="text-emerald-400">
                                {profile.sampleCount || profile.embeddings?.length || 1} sample(s)
                              </span>
                              <span>&bull;</span>
                              <span>{new Date(profile.createdAt).toLocaleDateString()}</span>
                            </div>

                            {notes && (
                              <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 bg-zinc-900/60 p-1.5 rounded border border-zinc-800/60">
                                {notes}
                              </p>
                            )}

                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {tags.map((tag, tIdx) => (
                                  <span
                                    key={tIdx}
                                    className="px-1.5 py-0.2 rounded text-[9px] bg-zinc-800 text-zinc-300 border border-zinc-700"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 mt-1">
                          <button
                            onClick={() => handleOpenEdit(profile)}
                            className="text-xs text-zinc-400 hover:text-cyan-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-800 transition-all"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDeleteIdentity(profile.id)}
                                className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[11px] flex items-center gap-1"
                              >
                                <Check className="w-3 h-3" />
                                <span>Confirm Delete</span>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(profile.id)}
                              title="Delete identity"
                              className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* TAB 2: ADD CUSTOM IDENTITY */}
          {activeTab === 'add' && (
            <form onSubmit={handleSaveCustomIdentity} className="flex flex-col gap-3 bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-xs">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800 text-emerald-400 font-bold">
                <UserPlus className="w-4 h-4" />
                <span>Create New Biometric Identity Profile</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-zinc-300 font-semibold">
                    Full Name / Identifier <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Alex Mercer, Sarah Connor"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-zinc-300 font-semibold">Role / Designation</label>
                  <input
                    type="text"
                    placeholder="e.g. Lead Engineer, VIP Guest, Staff"
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-semibold">Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. VIP, Staff, Authorized, Lab-Alpha"
                  value={addTags}
                  onChange={(e) => setAddTags(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-semibold">Notes / Bio Description</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Authorized for Level 2 access. Shift: 9am-5pm."
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Photo Upload / Seed */}
              <div className="flex flex-col gap-1.5 pt-1">
                <label className="text-zinc-300 font-semibold">Profile Photo (Optional)</label>
                <div className="flex items-center gap-3">
                  {addPhotoUrl ? (
                    <div className="relative">
                      <img
                        src={addPhotoUrl}
                        alt="Preview"
                        className="w-14 h-14 rounded-lg border border-emerald-500 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setAddPhotoUrl(null)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px]"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg cursor-pointer text-zinc-300 transition-all">
                      <ImageIcon className="w-4 h-4 text-cyan-400" />
                      <span>Upload Portrait Image</span>
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleCustomPhotoSelected}
                        className="hidden"
                      />
                    </label>
                  )}
                  <span className="text-[11px] text-zinc-500">
                    Embeddings will be computed from image if face detected.
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800 mt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('profiles')}
                  className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingCustom || !addName.trim()}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.3)] transition-all"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSavingCustom ? 'Saving...' : 'Save & Register Identity'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: SIGHTINGS */}
          {activeTab === 'sightings' && (
            <>
              {sightings.length === 0 ? (
                <div className="text-center py-12 text-xs text-zinc-500">
                  No sightings recorded yet in this session.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">
                      Recent Sighting Records ({sightings.length})
                    </span>
                    {confirmClearSightings ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleExecuteClearSightings}
                          className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[11px]"
                        >
                          Confirm Clear
                        </button>
                        <button
                          onClick={() => setConfirmClearSightings(false)}
                          className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmClearSightings(true)}
                        className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear Sightings</span>
                      </button>
                    )}
                  </div>

                  <div className="border border-zinc-800 rounded-xl overflow-hidden text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 text-[11px]">
                        <tr>
                          <th className="p-2.5">Time</th>
                          <th className="p-2.5">Identity</th>
                          <th className="p-2.5">Confidence</th>
                          <th className="p-2.5">Age Approx</th>
                          <th className="p-2.5">Observed Emotion</th>
                          <th className="p-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/50">
                        {sightings.map((s) => (
                          <tr key={s.id} className="hover:bg-zinc-800/40 transition-all">
                            <td className="p-2.5 text-zinc-400">
                              {new Date(s.timestamp).toLocaleTimeString()}
                            </td>
                            <td className="p-2.5 font-bold text-zinc-200">{s.personName}</td>
                            <td className="p-2.5 text-emerald-400 font-semibold">{s.confidence}%</td>
                            <td className="p-2.5 text-zinc-300">
                              {s.ageEstimate ? `~${s.ageEstimate}` : '--'}
                            </td>
                            <td className="p-2.5 capitalize text-amber-300">
                              {s.expression || '--'}
                            </td>
                            <td className="p-2.5 text-right">
                              <button
                                onClick={() => handleDeleteSighting(s.id)}
                                className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                                title="Delete log entry"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* EDIT MODAL POPUP */}
        {editingIdentity && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-60 flex items-center justify-center p-4">
            <form
              onSubmit={handleSaveEdit}
              className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-full max-w-md shadow-2xl flex flex-col gap-3 font-mono text-xs"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2 text-cyan-400 font-bold">
                  <Edit3 className="w-4 h-4" />
                  <span>Edit Identity: {editingIdentity.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingIdentity(null)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-semibold">Identity Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-semibold">Role / Title</label>
                <input
                  type="text"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  placeholder="e.g. Lead Engineer, VIP Guest"
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-semibold">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="e.g. VIP, Staff, Authorized"
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-semibold">Notes / Description</label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="e.g. Access permissions, schedule notes..."
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingIdentity(null)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-zinc-500 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Biometric descriptors remain strictly local on device.</span>
          </div>

          {confirmClearAll ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-red-400 font-bold">Clear all memory?</span>
              <button
                onClick={handleExecuteClearAll}
                className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[11px]"
              >
                Yes, Delete All
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClearAll(true)}
              className="text-red-400 hover:text-red-300 text-[11px] flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear All Memory</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
