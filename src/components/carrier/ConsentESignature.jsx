import React, { useMemo, useState } from 'react';
import '../../styles/carrier/ConsentESignature.css';
import { jsPDF } from 'jspdf';

export default function ConsentESignature() {
  const [activeTab, setActiveTab] = useState('active-signatures');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');

  const getDefaultDocumentExportType = () => {
    try {
      const stored = JSON.parse(localStorage.getItem('fp_carrier_preferences') || '{}') || {};
      const raw = String(stored.defaultDocumentExportType || '').trim().toLowerCase();
      return raw === 'pdf' || raw === 'json' || raw === 'csv' ? raw : 'pdf';
    } catch {
      return 'pdf';
    }
  };

  const downloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const escapeCsvCell = (value) => {
    const s = value == null ? '' : String(value);
    const escaped = s.replace(/"/g, '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const exportRows = ({ title, filenameBase, columns, rows }) => {
    const type = getDefaultDocumentExportType();
    const safeBase = String(filenameBase || 'export').trim() || 'export';
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10);

    if (type === 'json') {
      const payload = {
        title,
        exported_at: now.toISOString(),
        rows,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      downloadBlob(blob, `${safeBase}_${dateStamp}.json`);
      return;
    }

    if (type === 'csv') {
      const header = columns.map((c) => escapeCsvCell(c.header)).join(',');
      const lines = (rows || []).map((row) => {
        return columns
          .map((c) => {
            try {
              return escapeCsvCell(c.value(row));
            } catch {
              return '';
            }
          })
          .join(',');
      });
      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, `${safeBase}_${dateStamp}.csv`);
      return;
    }

    // PDF
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const marginX = 40;
    let y = 50;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title || 'Export', marginX, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Exported: ${now.toLocaleString()}`, marginX, y);
    y += 18;

    const maxWidth = 540;
    const lineHeight = 14;
    const addLine = (text) => {
      const lines = doc.splitTextToSize(String(text || ''), maxWidth);
      for (const l of lines) {
        if (y > 760) {
          doc.addPage();
          y = 50;
        }
        doc.text(l, marginX, y);
        y += lineHeight;
      }
    };

    (rows || []).forEach((row, idx) => {
      if (idx > 0) y += 6;
      addLine(`${idx + 1}. ${columns.map((c) => `${c.header}: ${c.value(row) ?? ''}`).join(' | ')}`);
    });

    const blob = doc.output('blob');
    downloadBlob(blob, `${safeBase}_${dateStamp}.pdf`);
  };
  
  // Active Signatures state
  const [documentSearch, setDocumentSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('All Document Types');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectAll, setSelectAll] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState([]);

  // Templates data matching the screenshot
  const templates = [
    {
      id: 1,
      name: 'Driver Employment Agreement',
      description: 'Comprehensive employment contract for new drivers including terms, conditions, and safety requirements.',
      category: 'HR',
      categoryColor: '#4285f4',
      icon: 'fa-solid fa-user',
      updated: '2 days ago'
    },
    {
      id: 2,
      name: 'Safety Training Acknowledgment',
      description: 'Mandatory safety training completion form with acknowledgement of safety protocols and procedures.',
      category: 'Safety',
      categoryColor: '#22c55e',
      icon: 'fa-solid fa-shield-halved',
      updated: '1 week ago'
    },
    {
      id: 3,
      name: 'Non-Disclosure Agreement',
      description: 'Standard NDA template for protecting confidential business information and trade secrets.',
      category: 'Legal',
      categoryColor: '#9c27b0',
      icon: 'fa-solid fa-scale-balanced',
      updated: '3 days ago'
    },
    {
      id: 4,
      name: 'DOT Physical Certification',
      description: 'Medical examination certification form required for commercial driver compliance.',
      category: 'Compliance',
      categoryColor: '#ff9800',
      icon: 'fa-solid fa-stethoscope',
      updated: '5 days ago'
    },
    {
      id: 5,
      name: 'Broker Service Agreement',
      description: 'Standard service agreement template for establishing partnerships with freight brokers.',
      category: 'Legal',
      categoryColor: '#e91e63',
      icon: 'fa-solid fa-handshake',
      updated: '1 week ago'
    },
    {
      id: 6,
      name: 'Background Check Authorization',
      description: 'Authorization form for conducting background checks on potential drivers and employees.',
      category: 'HR',
      categoryColor: '#00bcd4',
      icon: 'fa-solid fa-user-check',
      updated: '4 days ago'
    }
  ];

  // Mock data for signature activity
  const signatureActivity = [
    {
      id: 1,
      document: 'Driver Employment Agreement',
      signer: 'John Martinez',
      status: 'Completed',
      timestamp: '2 hours ago',
      statusColor: 'green'
    },
    {
      id: 2,
      document: 'Safety Training Acknowledgment',
      signer: 'Sarah Johnson',
      status: 'Pending',
      timestamp: '1 day ago',
      statusColor: 'orange'
    },
    {
      id: 3,
      document: 'NDA - Broker Partnership',
      signer: 'FastTrack Logistics',
      status: 'Sent',
      timestamp: '3 days ago',
      statusColor: 'blue'
    }
  ];

  const categories = ['All Categories', 'HR', 'Safety', 'Legal', 'Compliance'];

  // Statistics data
  const signatureStats = {
    pending: 24,
    partiallySigned: 8,
    completedToday: 12,
    overdue: 3
  };

  // Active documents data
  const activeDocuments = [
    {
      id: 1,
      name: 'Driver Agreement - Q4 2024',
      type: 'PDF',
      size: '2.4 MB',
      recipients: [
        { name: 'Mike Johnson', status: 'Pending', avatar: 'MJ' },
        { name: 'Sarah Davis', status: 'Signed', avatar: 'SD' }
      ],
      initiator: 'John Carter',
      dateSent: 'Jan 15, 2025',
      dueDate: 'Jan 22, 2025',
      status: 'Partially Signed',
      statusColor: 'orange',
      icon: 'fa-file-alt',
      iconColor: 'blue'
    },
    {
      id: 2,
      name: 'NDA - TechCorp Partnership',
      type: 'PDF',
      size: '1.8 MB',
      recipients: [
        { name: 'Robert Wilson', status: 'Declined', avatar: 'RW' }
      ],
      initiator: 'John Carter',
      dateSent: 'Jan 12, 2025',
      dueDate: 'Jan 19, 2025',
      status: 'Declined',
      statusColor: 'red',
      icon: 'fa-file-contract',
      iconColor: 'purple'
    },
    {
      id: 3,
      name: 'Safety Handbook 2025',
      type: 'PDF',
      size: '5.2 MB',
      recipients: [
        { name: 'Lisa Martinez', status: 'Pending', avatar: 'LM' },
        { name: 'David Brown', status: 'Pending', avatar: 'DB' }
      ],
      moreRecipients: 3,
      initiator: 'Emily Johnson',
      dateSent: 'Jan 14, 2025',
      dueDate: 'Jan 28, 2025',
      status: 'Pending',
      statusColor: 'orange',
      icon: 'fa-book',
      iconColor: 'orange'
    },
    {
      id: 4,
      name: 'Carrier Onboarding Packet',
      type: 'PDF',
      size: '3.1 MB',
      recipients: [
        { name: 'Amanda White', status: 'Signed', avatar: 'AW' }
      ],
      initiator: 'John Carter',
      dateSent: 'Jan 10, 2025',
      dueDate: 'Jan 17, 2025',
      status: 'Signed',
      statusColor: 'green',
      icon: 'fa-clipboard-check',
      iconColor: 'green'
    },
    {
      id: 5,
      name: 'Bill of Lading - Load #2458',
      type: 'PDF',
      size: '1.2 MB',
      recipients: [
        { name: 'Mike Johnson', status: 'Pending', avatar: 'MJ' }
      ],
      initiator: 'Emily Johnson',
      dateSent: 'Jan 16, 2025',
      dueDate: 'Jan 18, 2025',
      status: 'Overdue',
      statusColor: 'red',
      icon: 'fa-file-alt',
      iconColor: 'blue'
    }
  ];

  const completedArchiveDocuments = useMemo(() => {
    return [
      {
        id: 1,
        title: 'Carrier Safety Packet v2.1',
        meta: 'Contract #CSP-2024-001',
        iconColor: 'red',
        iconClass: 'fa-solid fa-file-pdf',
        recipient: { avatar: 'JS', name: 'John Smith' },
        moreRecipients: '+2 others',
        completedAt: 'Dec 15, 2024 2:34 PM',
        retentionLabel: '3-Year Storage',
        retentionClass: 'three-year',
        statusLabel: 'Signed & Archived',
      },
      {
        id: 2,
        title: 'Master Service Agreement',
        meta: 'Contract #MSA-2024-089',
        iconColor: 'blue',
        iconClass: 'fa-solid fa-file-alt',
        recipient: { avatar: 'SJ', name: 'Sarah Johnson' },
        moreRecipients: '',
        completedAt: 'Dec 14, 2024 11:22 AM',
        retentionLabel: 'Permanent',
        retentionClass: 'permanent',
        statusLabel: 'Signed & Archived',
      },
      {
        id: 3,
        title: 'Bill of Lading #BOL-789456',
        meta: 'Load #FP-2024-3421',
        iconColor: 'green',
        iconClass: 'fa-solid fa-file-excel',
        recipient: { avatar: 'MD', name: 'Mike Davis' },
        moreRecipients: '+1 other',
        completedAt: 'Dec 13, 2024 4:15 PM',
        retentionLabel: '5-Year Storage',
        retentionClass: 'five-year',
        statusLabel: 'Signed & Archived',
      },
      {
        id: 4,
        title: 'Non-Disclosure Agreement',
        meta: 'NDA-2024-156',
        iconColor: 'purple',
        iconClass: 'fa-solid fa-shield-alt',
        recipient: { avatar: 'LC', name: 'Lisa Chen' },
        moreRecipients: '',
        completedAt: 'Dec 12, 2024 9:45 AM',
        retentionLabel: '3-Year Storage',
        retentionClass: 'three-year',
        statusLabel: 'Signed & Archived',
      },
      {
        id: 5,
        title: 'Proof of Delivery #POD-321987',
        meta: 'Load #FP-2024-3420',
        iconColor: 'orange',
        iconClass: 'fa-solid fa-clipboard-check',
        recipient: { avatar: 'RW', name: 'Robert Wilson' },
        moreRecipients: '+2 others',
        completedAt: 'Dec 11, 2024 6:30 PM',
        retentionLabel: '5-Year Storage',
        retentionClass: 'five-year',
        statusLabel: 'Signed & Archived',
      },
    ];
  }, []);

  const exportActiveSignatureList = () => {
    exportRows({
      title: 'Active Signatures',
      filenameBase: 'active_signatures',
      rows: activeDocuments,
      columns: [
        { header: 'Document', value: (r) => r?.name || '' },
        { header: 'Type', value: (r) => r?.type || '' },
        { header: 'Initiator', value: (r) => r?.initiator || '' },
        { header: 'Date Sent', value: (r) => r?.dateSent || '' },
        { header: 'Due Date', value: (r) => r?.dueDate || '' },
        { header: 'Status', value: (r) => r?.status || '' },
        {
          header: 'Recipients',
          value: (r) => (r?.recipients || []).map((x) => x?.name).filter(Boolean).join('; '),
        },
      ],
    });
  };

  const exportCompletedArchiveList = () => {
    exportRows({
      title: 'Completed Archive',
      filenameBase: 'completed_archive',
      rows: completedArchiveDocuments,
      columns: [
        { header: 'Document', value: (r) => r?.title || '' },
        { header: 'Meta', value: (r) => r?.meta || '' },
        { header: 'Recipient', value: (r) => r?.recipient?.name || '' },
        { header: 'Date Completed', value: (r) => r?.completedAt || '' },
        { header: 'Retention Tag', value: (r) => r?.retentionLabel || '' },
        { header: 'Status', value: (r) => r?.statusLabel || '' },
      ],
    });
  };

  const itemsPerPage = 5;
  const totalPages = Math.ceil(activeDocuments.length / itemsPerPage);
  const currentDocuments = activeDocuments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedDocuments([]);
    } else {
      setSelectedDocuments(currentDocuments.map(doc => doc.id));
    }
    setSelectAll(!selectAll);
  };

  const handleDocumentSelect = (documentId) => {
    if (selectedDocuments.includes(documentId)) {
      setSelectedDocuments(selectedDocuments.filter(id => id !== documentId));
    } else {
      setSelectedDocuments([...selectedDocuments, documentId]);
    }
  };

  const getColorClass = (color) => {
    const colorMap = {
      blue: 'template-blue',
      green: 'template-green',
      purple: 'template-purple',
      orange: 'template-orange',
      red: 'template-red',
      teal: 'template-teal'
    };
    return colorMap[color] || 'template-blue';
  };

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All Categories' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="consent-esignature">
      {/* Header */}
      <header className="consent-header">
        <div className="header-content">
          <h1>Consent & eSignature</h1>
          <p className="header-subtitle">Manage digital signatures, templates, and compliance documentation</p>
        </div>
        <div className="header-actions">
          {activeTab === 'active-signatures' ? (
            <>
              <button className="btn small ghost-cd">
                <i className="fa-solid fa-plus"></i>
                New Document
              </button>
              <button className="btn small ghost-cd" onClick={exportActiveSignatureList}>
                <i className="fa-solid fa-file-export"></i>
                Export List
              </button>
            </>
          ) : activeTab === 'completed-archive' ? (
            <>
              <button className="btn small ghost-cd" onClick={exportCompletedArchiveList}>
                <i className="fa-solid fa-download"></i>
                Export
              </button>
              <button className="btn small ghost-cd">
                <i className="fa-solid fa-archive"></i>
                Move to Vault
              </button>
            </>
          ) : (
            <>
              <button className="btn small ghost-cd">
                <i className="fa-solid fa-plus"></i>
                Create Agreement
              </button>
              <button className="btn small ghost-cd">
                <i className="fa-solid fa-upload"></i>
                Upload Template
              </button>
            </>
          )}
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="consent-tabs">
        <button 
          className={`tab-btn ${activeTab === 'template-library' ? 'active' : ''}`}
          onClick={() => setActiveTab('template-library')}
        >
          Template Library
        </button>
        <button 
          className={`tab-btn ${activeTab === 'active-signatures' ? 'active' : ''}`}
          onClick={() => setActiveTab('active-signatures')}
        >
          Active Signatures
        </button>
        <button 
          className={`tab-btn ${activeTab === 'completed-archive' ? 'active' : ''}`}
          onClick={() => setActiveTab('completed-archive')}
        >
          Completed Archive
        </button>
      </div>

      {/* Template Library Tab */}
      {activeTab === 'template-library' && (
        <div className="template-library">
          {/* Search and Filter Bar */}
          <div className="integrations-controls">
            <div className="search-container">
              <i className="fas fa-search search-icon"></i>
              <input
                type="text"
                placeholder="Search templates..."
                className="integrations-search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="cs-filters-container">
              <select 
                className="int-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Templates Grid */}
          <div className="templates-grid">
            {filteredTemplates.map((template) => (
              <div key={template.id} className="template-card">
                <div className="template-header">
                  <div className="template-category-badge">
                    <i className={template.icon}></i>
                  </div>
                  <div className="template-category-label">{template.category}</div>
                </div>
                <div className="template-content">
                  <h3 className="template-name">{template.name}</h3>
                  <p className="template-description">{template.description}</p>
                  <div className="template-meta">
                    <span className="template-updated">Updated {template.updated}</span>
                  </div>
                </div>
                <div className="template-actions">
                  <button className="btn small-cd">Use Template</button>
                </div>
              </div>
            ))}
          </div>
          <div className="recent-activity-section">
        <h3>Recent Signature Activity</h3>
        <div className="activity-list">
          {signatureActivity.map((activity) => (
            <div key={activity.id} className="cs-activity-item">
              <div className="activity-icon">
                <i className={`fa-solid ${
                  activity.status === 'Completed' ? 'fa-check-circle' :
                  activity.status === 'Pending' ? 'fa-clock' : 'fa-paper-plane'
                }`}></i>
              </div>
              <div className="activity-content">
                <div className="activity-document">{activity.document}</div>
                <div className="activity-signer">Signed by {activity.signer}</div>
              </div>
              <div className="activity-status">
                <span className={`status-badge ${activity.statusColor}`}>{activity.status}</span>
                <div className="activity-time">{activity.timestamp}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
        </div>
      )}

      {/* Active Signatures Tab */}
      {activeTab === 'active-signatures' && (
        <div className="active-signatures">
          {/* Statistics Cards */}
          <div className="signature-stats">
            <div className="sig-stat-card pending">
              <div className="sig-stat-icon">
                <i className="fa-solid fa-clock"></i>
              </div>
              <div className="sig-stat-content">
                <div className="sig-stat-label">Pending</div>
                <div className="sig-stat-value">{signatureStats.pending}</div>
              </div>
            </div>
            <div className="sig-stat-card partially-signed">
              <div className="sig-stat-icon">
                <i className="fa-solid fa-pen-alt"></i>
              </div>
              <div className="sig-stat-content">
                <div className="sig-stat-label">Partially Signed</div>
                <div className="sig-stat-value">{signatureStats.partiallySigned}</div>
              </div>
            </div>
            <div className="sig-stat-card completed">
              <div className="sig-stat-icon">
                <i className="fa-solid fa-check-circle"></i>
              </div>
              <div className="sig-stat-content">
                <div className="sig-stat-label">Completed Today</div>
                <div className="sig-stat-value">{signatureStats.completedToday}</div>
              </div>
              
            </div>
            <div className="sig-stat-card overdue">
              <div className="sig-stat-icon">
                <i className="fa-solid fa-exclamation-triangle"></i>
              </div>
              <div className="sig-stat-content">
                <div className="sig-stat-label">Overdue</div>
                <div className="sig-stat-value">{signatureStats.overdue}</div>
              </div>
              
            </div>
          </div>

          <div className="integrations-controls">
            <div className="search-container">
              <i className="fas fa-search search-icon"></i>
              <input
                type="text"
                placeholder="Search Documents..."
                className="integrations-search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="cs-filters-container">
              <select 
                className="int-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
               <option value="All Status">All Status</option>
                <option value="Pending">Pending</option>
                <option value="Partially Signed">Partially Signed</option>
                <option value="Signed">Signed</option>
                <option value="Declined">Declined</option>
                <option value="Overdue">Overdue</option>
              </select>

              <select 
                className="int-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
               <option value="All Document Types">All Document Types</option>
                <option value="PDF">PDF</option>
                <option value="DOC">DOC</option>
                <option value="DOCX">DOCX</option>
              </select>
            </div>
          </div>

          {/* Active Documents Table */}
          <div className="documents-table-container">
            <div className="cs-table-header">
              <h3>Active Documents</h3>
              <div className="table-actions">
                <label className="select-all">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                  />
                  Select All
                </label>
              </div>
            </div>

            <div className="documents-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>DOCUMENT NAME</th>
                    <th>RECIPIENTS</th>
                    <th>INITIATOR</th>
                    <th>DATE SENT</th>
                    <th>DUE DATE</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {currentDocuments.map((document) => (
                    <tr key={document.id} className={selectedDocuments.includes(document.id) ? 'selected' : ''}>
                      <td data-label="Select">
                        <input
                          type="checkbox"
                          checked={selectedDocuments.includes(document.id)}
                          onChange={() => handleDocumentSelect(document.id)}
                        />
                      </td>
                      <td data-label="Document">
                        <div className="document-name-cell">
                          <div className={`document-icon`}>
                            <i className={`fa-solid ${document.icon}`}></i>
                          </div>
                          <div className="document-info">
                            <div className="document-title">{document.name}</div>
                            <div className="document-meta">{document.type} • {document.size}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Recipients">
                        <div className="recipients-cell">
                          {document.recipients.map((recipient, index) => (
                            <div key={index} className="recipient-item">
                              <div className="recipient-avatar">{recipient.avatar}</div>
                              <div className="recipient-info">
                                <div className="recipient-name">{recipient.name}</div>
                                <div className={`recipient-status ${recipient.status.toLowerCase()}`}>
                                  {recipient.status}
                                </div>
                              </div>
                            </div>
                          ))}
                          {document.moreRecipients && (
                            <div className="more-recipients">
                              +{document.moreRecipients} more recipients
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="Initiator">
                        <div className="initiator-cell">
                          <div className="initiator-avatar">
                            <i className="fa-solid fa-user"></i>
                          </div>
                          <div className="initiator-name">{document.initiator}</div>
                        </div>
                      </td>
                      <td data-label="Date Sent" className="date-cell">{document.dateSent}</td>
                      <td data-label="Due Date" className={`due-date-cell ${document.status === 'Overdue' ? 'overdue' : ''}`}>
                        {document.dueDate}
                      </td>
                      <td data-label="Status">
                        <span className={`status-badge ${document.statusColor}`}>
                          {document.status === 'Partially Signed' ? 'Partially Signed' : document.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="drivers-pagination">
            <span>Showing 1-5 of 1,247 drivers</span>
            <div className="pagination">
              <button aria-label="Previous page">&lt;</button>
              <button className="active" aria-current="page">1</button>
              <button>2</button>
              <button>3</button>
              <span>...</span>
              <button>25</button>
              <button aria-label="Next page">&gt;</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Completed Archive Tab */}
      {activeTab === 'completed-archive' && (
        <div className="completed-archive">
          {/* Document Filters */}
          <div className="integrations-controls">
            <div className="search-container">
              <i className="fas fa-search search-icon"></i>
              <input
                type="text"
                placeholder="Search Documents..."
                className="integrations-search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="cs-filters-container">
              <select 
                className="int-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
               <option value="All Status">All Status</option>
                <option value="Pending">Pending</option>
                <option value="Partially Signed">Partially Signed</option>
                <option value="Signed">Signed</option>
                <option value="Declined">Declined</option>
                <option value="Overdue">Overdue</option>
              </select>

              <select 
                className="int-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
               <option value="All Document Types">All Document Types</option>
                <option value="PDF">PDF</option>
                <option value="DOC">DOC</option>
                <option value="DOCX">DOCX</option>
              </select>
            </div>
          </div>

          {/* Archive Documents Table */}
          <div className="documents-table-container">
            <div className="documents-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>DOCUMENT NAME</th>
                    <th>RECIPIENTS</th>
                    <th>DATE COMPLETED</th>
                    <th>RETENTION TAG</th>
                    <th>STATUS</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {completedArchiveDocuments.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Select">
                        <input type="checkbox" />
                      </td>
                      <td data-label="Document">
                        <div className="document-name-cell">
                          <div className={`document-icon ${d.iconColor}`}>
                            <i className={d.iconClass}></i>
                          </div>
                          <div className="document-info">
                            <div className="document-title">{d.title}</div>
                            <div className="document-meta">{d.meta}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Recipients">
                        <div className="recipients-cell">
                          <div className="recipient-item">
                            <div className="recipient-avatar">{d.recipient.avatar}</div>
                            <span className="recipient-name">{d.recipient.name}</span>
                          </div>
                          {d.moreRecipients ? <div className="more-recipients">{d.moreRecipients}</div> : null}
                        </div>
                      </td>
                      <td data-label="Date Completed">
                        <div className="date-cell">{d.completedAt}</div>
                      </td>
                      <td data-label="Retention Tag">
                        <span className={`retention-tag ${d.retentionClass}`}>{d.retentionLabel}</span>
                      </td>
                      <td data-label="Status">
                        <span className="status-badge green">{d.statusLabel}</span>
                      </td>
                      <td data-label="Action">
                        <button className="actionn-btnn view">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="drivers-pagination">
            <span>Showing 1-5 of 1,247 drivers</span>
            <div className="pagination">
              <button aria-label="Previous page">&lt;</button>
              <button className="active" aria-current="page">1</button>
              <button>2</button>
              <button>3</button>
              <span>...</span>
              <button>25</button>
              <button aria-label="Next page">&gt;</button>
            </div>
          </div>
          </div>

          {/* Retention & Compliance Notice */}
          <div className="retention-compliance-notice">
            <div className="notice-content">
              <div className="notice-icon">
                <i className="fa-solid fa-info-circle"></i>
              </div>
              <div className="notice-text">
                <h4>Retention & Compliance</h4>
                <p>Documents are automatically tagged with retention policies based on type and regulatory requirements.</p>
              </div>
            </div>
            <div className="notice-actions">
              <button className="btn small-cd" onClick={exportCompletedArchiveList}>
                <i className="fa-solid fa-download"></i>
                Compliance Export
              </button>
              <button className="btn small ghost-cd">
                <i className="fa-solid fa-cog"></i>
                Retention Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}