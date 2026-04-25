import React from 'react';
import '../../styles/admin/DocumentVault.css';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';
import { getJson, postJson } from '../../api/http';

export default function AdminDocumentVault() {
  const { currentUser } = useAuth();
  const fileInputRef = React.useRef(null);
  const [documents, setDocuments] = React.useState([]);
  const [search, setSearch] = React.useState('');

  const loadDocuments = React.useCallback(async () => {
    try {
      const data = await getJson('/documents?page=1&page_size=100');
      setDocuments(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setDocuments([]);
      alert(e?.message || 'Failed to load documents');
    }
  }, []);

  React.useEffect(() => {
    if (currentUser) loadDocuments();
  }, [currentUser, loadDocuments]);

  const handleUploadClick = () => {
    if (!currentUser) {
      alert('Please sign in to upload documents.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!currentUser) return;

    try {
      const token = await currentUser.getIdToken();
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${API_URL}/documents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });

        if (response.ok) {
          alert(`Document "${file.name}" uploaded successfully!`);
          await loadDocuments();
        } else {
          let errorDetail = 'Unknown error';
          try {
            const error = await response.json();
            errorDetail = error?.detail || error?.message || errorDetail;
          } catch (_) {
            // ignore
          }
          alert(`Failed to upload "${file.name}": ${errorDetail}`);
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed. Please try again.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const autoOrganize = async () => {
    try {
      const data = await postJson('/admin/documents/auto-organize', {});
      alert(`Auto-organized ${Number(data?.organized || 0)} document(s).`);
      await loadDocuments();
    } catch (e) {
      alert(e?.message || 'Failed to auto-organize documents');
    }
  };

  const visibleDocs = React.useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    if (!q) return documents;
    return (documents || []).filter((d) => {
      const name = String(d?.filename || d?.file_name || d?.name || '').toLowerCase();
      const kind = String(d?.document_type || d?.type || '').toLowerCase();
      return name.includes(q) || kind.includes(q);
    });
  }, [documents, search]);

  return (
    <div className="dv-root admin-dv">
      <header className="fp-header">
        <div className="fp-header-titles">
          <h2>Documents</h2>
        </div>
      </header>

      <div className="dv-top-row">
        <div className="dv-controls">
          <div className="dv-search">
            <input placeholder="Search documents (OCR-enabled)" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn small ghost-cd" type="button" onClick={loadDocuments}>Filters</button>
          <button className="btn small ghost-cd" type="button" onClick={autoOrganize}>Auto-Organize</button>
          <button className="btn small-cd" type="button" onClick={handleUploadClick}>+ Upload</button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileUpload}
        aria-label="Upload documents"
      />

      <div className="dv-table-wrap">
        <table className="dv-table">
          <thead>
            <tr>
              <th>File Name</th>
              <th>Tenant</th>
              <th>Type</th>
              <th>Status</th>
              <th>Expiry</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleDocs.length === 0 ? (
              <tr>
                <td colSpan={6}>No documents found.</td>
              </tr>
            ) : (
              visibleDocs.map((d) => (
                <tr key={d?.id || d?.document_id || d?.filename}>
                  <td><i className="fa-regular fa-file-pdf file-ic pdf" /> <strong>{d?.filename || d?.name || 'document'}</strong></td>
                  <td>{d?.owner_name || d?.uploaded_by_name || '—'}</td>
                  <td>{d?.document_type || d?.type || 'General'}</td>
                  <td><span className="int-status-badge active">{d?.status || 'Uploaded'}</span></td>
                  <td>{d?.expiry_date || '—'}</td>
                  <td><i className='fa-solid fa-ellipsis-h'></i></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
