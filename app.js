import { jsPDF } from 'jspdf';

// Handle quoted-printable encoding and UTF-8
const decodeQuotedPrintable = (text) => {
    // First handle line wrapping (remove = at end of lines)
    text = text.replace(/=\r\n/g, '').replace(/=\n/g, '');

    // Then decode hex characters, handling UTF-8 sequences
    let result = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '=' && i + 2 < text.length) {
            try {
                const hex1 = parseInt(text.substr(i + 1, 2), 16);
                // Check if this is start of UTF-8 sequence
                if (hex1 > 0x7F) {
                    // Collect all bytes of the UTF-8 sequence
                    const bytes = [hex1];
                    let j = i + 3;
                    while (bytes.length < 4 && j + 2 < text.length && text[j] === '=') {
                        const hex = parseInt(text.substr(j + 1, 2), 16);
                        bytes.push(hex);
                        j += 3;
                    }
                    // Convert UTF-8 bytes to character
                    result += new TextDecoder().decode(new Uint8Array(bytes));
                    i = j;
                } else {
                    result += String.fromCharCode(hex1);
                    i += 3;
                }
            } catch (e) {
                result += text[i];
                i++;
            }
        } else {
            result += text[i];
            i++;
        }
    }
    return result;
};

document.addEventListener('DOMContentLoaded', function () {
    // DOM Elements
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const status = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const progress = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    const downloadBtn = document.getElementById('downloadBtn');
    const clearBtn = document.getElementById('clearBtn');
    const fileList = document.getElementById('fileList');
    const fileItemsContainer = document.getElementById('fileItemsContainer');

    // App State
    let emailFiles = [];
    let parsedEmails = [];

    // Event Listeners
    initializeEventListeners();

    // Functions
    function initializeEventListeners() {
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        // Highlight drop area when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, unhighlight, false);
        });

        // Handle dropped files
        dropArea.addEventListener('drop', handleDrop, false);

        // Handle selected files
        fileInput.addEventListener('change', handleFiles, false);

        // Handle download button
        downloadBtn.addEventListener('click', generatePDF, false);

        // Handle clear button
        clearBtn.addEventListener('click', clearAll, false);
    }

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight() {
        dropArea.classList.add('highlight');
    }

    function unhighlight() {
        dropArea.classList.remove('highlight');
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles({ target: { files } });
    }

    function handleFiles(e) {
        const files = Array.from(e.target.files).filter(file => file.name.endsWith('.eml'));
        if (files.length === 0) {
            showStatus('No .eml files selected. Please select valid .eml files.', 'error');
            return;
        }

        emailFiles = files;
        showStatus(`Processing ${files.length} .eml files...`);

        // Display file list
        displayFileList(files);

        // Parse each email file
        parseEmailFiles(files)
            .then(emails => {
                parsedEmails = emails;
                downloadBtn.disabled = false;
                clearBtn.disabled = false;
                showStatus(`${emails.length} emails parsed successfully. Ready to generate PDF.`, 'success');
            })
            .catch(error => {
                showStatus(`Error: ${error.message}`, 'error');
            });
    }

    function displayFileList(files) {
        fileItemsContainer.innerHTML = '';
        files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.classList.add('file-item');
            fileItem.innerHTML = `<i class="fas fa-file-alt"></i>${file.name}`;
            fileItemsContainer.appendChild(fileItem);
        });
        fileList.style.display = 'block';
    }

    async function parseEmailFiles(files) {
        const emails = [];
        let processedFiles = 0;

        updateProgress(0);

        for (const file of files) {
            try {
                const email = await parseEmailFile(file);
                emails.push(email);

                processedFiles++;
                const percent = Math.round(processedFiles / files.length * 100);
                updateProgress(percent);
            } catch (error) {
                console.error(`Error parsing ${file.name}:`, error);
            }
        }

        // Sort emails by date (oldest to newest)
        return emails.sort((a, b) => a.date - b.date);
    }

    function parseEmailFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = function (e) {
                try {
                    const content = e.target.result;

                    // Extract email date from headers
                    let date = null;
                    let subject = 'No Subject';
                    let from = 'Unknown Sender';
                    let to = 'Unknown Recipient';
                    let body = '';

                    // Basic parsing of headers
                    const headerEnd = content.indexOf("\r\n\r\n");
                    if (headerEnd !== -1) {
                        const headers = content.substring(0, headerEnd);

                        // Extract date
                        const dateMatch = headers.match(/^Date:\s*(.*?)$/im);
                        if (dateMatch && dateMatch[1]) {
                            date = new Date(dateMatch[1].trim());
                        }

                        // Extract subject
                        const subjectMatch = headers.match(/^Subject:\s*(.*?)$/im);
                        if (subjectMatch && subjectMatch[1]) {
                            subject = subjectMatch[1].trim();
                        }

                        // Extract from
                        const fromMatch = headers.match(/^From:\s*(.*?)$/im);
                        if (fromMatch && fromMatch[1]) {
                            from = fromMatch[1].trim();
                        }

                        // Extract to
                        const toMatch = headers.match(/^To:\s*(.*?)$/im);
                        if (toMatch && toMatch[1]) {
                            to = toMatch[1].trim();
                        }

                        // Extract body (very simplified)
                        body = content.substring(headerEnd + 4);

                        // Handle multipart emails (very simplified)
                        const boundary = headers.match(/boundary="?([^";\r\n]+)"?/i);
                        if (boundary && boundary[1]) {
                            const parts = body.split('--' + boundary[1]);

                            // Look for text/plain or text/html part
                            let foundTextPart = false;
                            for (const part of parts) {
                                // Try text/plain first
                                if (part.match(/Content-Type:\s*text\/plain/i)) {
                                    const partHeaderEnd = part.indexOf("\r\n\r\n");
                                    if (partHeaderEnd !== -1) {
                                        body = part.substring(partHeaderEnd + 4);
                                        foundTextPart = true;
                                        break;
                                    }
                                }
                            }

                            // If no text/plain part found, try HTML part
                            if (!foundTextPart) {
                                for (const part of parts) {
                                    if (part.match(/Content-Type:\s*text\/html/i)) {
                                        const partHeaderEnd = part.indexOf("\r\n\r\n");
                                        if (partHeaderEnd !== -1) {
                                            body = part.substring(partHeaderEnd + 4);
                                            // Create a temporary div to parse HTML content
                                            const tempDiv = document.createElement('div');
                                            tempDiv.innerHTML = body;
                                            body = tempDiv.textContent || tempDiv.innerText || '';
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // First decode quoted-printable
                    subject = decodeQuotedPrintable(subject);
                    body = decodeQuotedPrintable(body);

                    // Then handle HTML entities and formatting
                    const decodeHtml = (html) => {
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        return doc.body.textContent;
                    };

                    // Decode HTML entities
                    subject = decodeHtml(subject);
                    body = decodeHtml(body);

                    // Clean up HTML formatting while preserving structure
                    body = body.replace(/<div>/gi, '\n')
                        .replace(/<\/div>/gi, '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<p>/gi, '\n')
                        .replace(/<\/p>/gi, '\n')
                        .replace(/\n\s*\n/g, '\n\n') // Collapse multiple newlines
                        .trim();

                    if (!date) {
                        date = new Date(); // Fallback if we can't parse the date
                    }

                    resolve({
                        filename: file.name,
                        date,
                        subject,
                        from,
                        to,
                        body,
                        content
                    });
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = function () {
                reject(new Error('Could not read the file'));
            };

            reader.readAsText(file);
        });
    }

    function updateProgress(percent) {
        progress.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
    }

    function showStatus(message, type = 'info') {
        status.classList.add('show');
        statusText.textContent = message;

        if (type === 'error') {
            statusText.style.color = 'crimson';
        } else if (type === 'success') {
            statusText.style.color = 'forestgreen';
        } else {
            statusText.style.color = 'black';
        }
    }

    function generatePDF() {
        if (parsedEmails.length === 0) {
            showStatus('No emails to generate PDF from', 'error');
            return;
        }

        showStatus('Generating PDF...');

        // Create a new jsPDF instance
        const doc = new jsPDF();
        let yPos = 20;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const leftMargin = 15;
        const rightMargin = pageWidth - 15;
        const textWidth = rightMargin - leftMargin;

        // Add cover page
        doc.setFontSize(24);
        doc.setFont(undefined, 'bold');
        doc.text('Email Archive', pageWidth / 2, 40, { align: 'center' });

        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.text(`Generated on ${new Date().toLocaleDateString()}`, pageWidth / 2, 50, { align: 'center' });
        doc.text(`Total emails: ${parsedEmails.length}`, pageWidth / 2, 60, { align: 'center' });

        // Add table of contents
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('Contents', leftMargin, 80);

        let tocYPos = 90;
        parsedEmails.forEach((email, index) => {
            if (tocYPos > pageHeight - 20) {
                doc.addPage();
                tocYPos = 20;
            }
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            const dateStr = email.date.toLocaleDateString();
            const truncatedSubject = email.subject.length > 50 ?
                email.subject.substring(0, 47) + '...' :
                email.subject;
            doc.text(`${index + 1}. ${dateStr} - ${truncatedSubject}`, leftMargin, tocYPos);
            tocYPos += 7;
        });

        // Add a page for emails
        doc.addPage();
        yPos = 20;

        parsedEmails.forEach((email, index) => {
            // Add a page break if not the first email and not enough space
            if (index > 0 && yPos > pageHeight - 40) {
                doc.addPage();
                yPos = 20;
            }

            // Format the date
            const formattedDate = email.date.toLocaleString();

            // Add email header info
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            const subject = `Subject: ${email.subject}`;
            doc.text(subject, leftMargin, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.text(`Date: ${formattedDate}`, leftMargin, yPos);
            yPos += 5;
            doc.text(`From: ${email.from}`, leftMargin, yPos);
            yPos += 5;
            doc.text(`To: ${email.to}`, leftMargin, yPos);
            yPos += 8;

            // Add separator line
            doc.setDrawColor(100, 100, 100);
            doc.line(leftMargin, yPos, rightMargin, yPos);
            doc.setDrawColor(0, 0, 0);
            yPos += 8;

            // Add email body
            doc.setFontSize(10);

            // Truncate very long bodies to prevent performance issues
            let bodyText = email.body;
            if (bodyText.length > 10000) {
                bodyText = bodyText.substring(0, 10000) + "... [truncated]";
            }

            // Decode any remaining quoted-printable content that might have been missed
            bodyText = decodeQuotedPrintable(bodyText);

            // Extract and format URLs
            const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
            const urlMatches = [...bodyText.matchAll(urlRegex)];
            let lastIndex = 0;
            let formattedLines = [];

            urlMatches.forEach(match => {
                const url = match[0];
                const beforeUrl = bodyText.substring(lastIndex, match.index);
                if (beforeUrl) {
                    const beforeLines = doc.splitTextToSize(beforeUrl, textWidth);
                    formattedLines.push(...beforeLines);
                }

                // Add URL as clickable link with underline
                doc.setTextColor(0, 0, 255); // Blue color for links
                doc.setLineWidth(0.5);
                const urlLines = doc.splitTextToSize(url, textWidth);
                urlLines.forEach((line, i) => {
                    formattedLines.push({ text: line, isLink: true, url: url });
                });
                doc.setTextColor(0); // Reset to black

                lastIndex = match.index + url.length;
            });

            // Add remaining text after last URL
            if (lastIndex < bodyText.length) {
                const remainingText = bodyText.substring(lastIndex);
                const remainingLines = doc.splitTextToSize(remainingText, textWidth);
                formattedLines.push(...remainingLines);
            }

            // Handle empty body or no URLs case
            if (formattedLines.length === 0) {
                formattedLines = doc.splitTextToSize(bodyText, textWidth);
            }

            // Check if we need a new page for the body
            const bodyLines = doc.splitTextToSize(bodyText, textWidth);

            // Check if we need a new page for the body
            if (yPos + Math.min(bodyLines.length, 50) * 5 > pageHeight - 15) {
                doc.addPage();
                yPos = 20;
            }

            // If body is very long, add it page by page
            const linesPerPage = Math.floor((pageHeight - 30) / 5);
            let startLine = 0;

            while (startLine < formattedLines.length) {
                const endLine = Math.min(startLine + linesPerPage, formattedLines.length);
                const pageLines = formattedLines.slice(startLine, endLine);

                pageLines.forEach(line => {
                    if (typeof line === 'object' && line.isLink) {
                        // Draw underlined clickable link
                        doc.setTextColor(0, 0, 255);
                        doc.textWithLink(line.text, leftMargin, yPos, {
                            url: line.url
                        });
                        doc.setTextColor(0);
                        // Add underline
                        const textWidth = doc.getTextWidth(line.text);
                        doc.line(leftMargin, yPos + 1, leftMargin + textWidth, yPos + 1);
                    } else {
                        doc.text(line, leftMargin, yPos);
                    }
                    yPos += 5;
                });

                startLine = endLine;

                if (startLine < formattedLines.length) {
                    doc.addPage();
                    yPos = 20;
                }
            }

            // Add spacing after email
            yPos += 15;

            // Add separator between emails
            if (index < parsedEmails.length - 1) {
                if (yPos > pageHeight - 30) {
                    doc.addPage();
                    yPos = 20;
                }
                doc.setDrawColor(200, 200, 200);
                doc.line(leftMargin, yPos, rightMargin, yPos);
                doc.setDrawColor(0, 0, 0);
                yPos += 10;
            }
        });

        // Save the PDF
        doc.save('email_archive.pdf');
        showStatus('PDF generated and downloaded successfully!', 'success');
    }

    function clearAll() {
        // Reset file input
        fileInput.value = '';

        // Clear file list
        fileItemsContainer.innerHTML = '';
        fileList.style.display = 'none';

        // Reset status
        updateProgress(0);
        status.classList.remove('show');

        // Disable buttons
        downloadBtn.disabled = true;
        clearBtn.disabled = true;

        // Clear arrays
        emailFiles = [];
        parsedEmails = [];

        showStatus('All files cleared. You can start fresh.', 'info');
        setTimeout(() => {
            status.classList.remove('show');
        }, 3000);
    }
});
