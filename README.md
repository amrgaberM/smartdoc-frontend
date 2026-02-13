# SmartDoc AI - Frontend

Modern React/Next.js interface for SmartDoc AI, an intelligent document management system powered by Retrieval-Augmented Generation (RAG). Upload PDFs, ask questions, and receive AI-generated answers with source citations.

**Backend API Repository:** [smartdoc-enterprise-api](https://github.com/amrgaberM/smartdoc-enterprise-api)

---

## Overview

SmartDoc Frontend is a production-ready web application built with Next.js 14 and TypeScript. It provides an intuitive interface for interacting with AI-powered document analysis, enabling users to upload PDFs, chat with individual documents, and search across their entire document library using natural language queries.

---

## Key Features

**Document Management**
- Drag-and-drop PDF upload with real-time progress tracking
- Document library with search and filtering capabilities
- Real-time status updates for document processing
- Individual document deletion and management

**AI-Powered Chat**
- Document-specific Q&A with context-aware responses
- Global search across all uploaded documents
- Source citations with page references and confidence scores
- Streaming responses with loading indicators

**Security & Authentication**
- JWT-based authentication with automatic token refresh
- Secure session management
- Protected routes with redirect handling
- Token expiration management

**User Experience**
- Responsive design optimized for desktop and mobile
- Real-time notifications for success and error states
- Loading skeletons and progress indicators
- Clean, modern UI with dark mode interface

---

## Technology Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| HTTP Client | Axios with interceptors |
| State Management | React Hooks (useState, useCallback, useMemo) |
| Routing | Next.js App Router |
| Build Tool | Turbopack |

---

## Prerequisites

- Node.js 18.x or higher
- npm or yarn package manager
- SmartDoc Backend API running locally or deployed

---

## Installation

### Clone the Repository
```bash
git clone https://github.com/amrgaberM/smartdoc-frontend.git
cd smartdoc-frontend
```

### Install Dependencies
```bash
npm install
```

### Environment Configuration

Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

For production deployment, update the API URL to your deployed backend:
```env
NEXT_PUBLIC_API_URL=https://your-backend-api.com/api
```

### Run Development Server
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

---

## Project Structure
```
src/
├── app/                    # Next.js App Router pages
│   ├── login/             # Authentication page
│   ├── signup/            # User registration
│   └── dashboard/         # Main application interface
├── lib/                   # Utility functions and configurations
│   └── api.ts            # Axios instance with JWT interceptors
├── components/            # Reusable React components (future)
├── types/                 # TypeScript type definitions (future)
└── styles/               # Global CSS and Tailwind config
```

---

## API Integration

The frontend communicates with the SmartDoc backend API through the configured `NEXT_PUBLIC_API_URL`. The Axios client in `lib/api.ts` handles:

- Automatic JWT token attachment to requests
- Token refresh on 401 errors
- Request/response interceptors
- Error handling and redirects

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/token/` | POST | User authentication |
| `/token/refresh/` | POST | Token refresh |
| `/users/` | POST | User registration |
| `/documents/` | GET, POST | Document listing and upload |
| `/documents/{id}/analyze/` | POST | Trigger document analysis |
| `/documents/{id}/ask/` | POST | Document-specific questions |
| `/documents/global_ask/` | POST | Cross-document search |

---

## Authentication Flow

1. User submits credentials via login form
2. Backend returns JWT access and refresh tokens
3. Tokens stored in localStorage
4. Axios interceptor attaches access token to all requests
5. On 401 response, interceptor automatically refreshes token
6. On refresh failure, user redirected to login page

---

## Features in Detail

### Document Upload

Users can upload PDF files up to 10MB. The upload process includes:
- File type validation (PDF only)
- Size validation (10MB limit)
- Real-time progress tracking
- Automatic document list refresh on completion

### Document Analysis

After upload, documents are in "pending" state. Users can trigger analysis which:
- Extracts text from PDF
- Generates semantic embeddings
- Creates searchable chunks
- Produces AI-generated summary

### Chat Interface

**Single Document Chat:**
- Opens sidebar with document-specific interface
- Maintains conversation history
- Displays source citations with page numbers
- Shows confidence scores for retrieved chunks

**Global Search:**
- Searches across all completed documents
- Returns answers with multi-document sources
- Displays which documents contributed to answer
- Prioritizes most relevant content

---

## Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

**Environment Variables:**
Set `NEXT_PUBLIC_API_URL` in Vercel dashboard to your production backend URL.

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t smartdoc-frontend .
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=https://api.example.com smartdoc-frontend
```

---

## Development Guidelines

### Code Style

- TypeScript strict mode enabled
- ESLint configuration for code quality
- Prettier for consistent formatting
- Component-based architecture

### State Management

- Local state with useState for component-level data
- useCallback for memoized functions
- useMemo for expensive computations
- No external state management library (keeps bundle small)

### Performance Optimizations

- Lazy loading for components
- Debounced search inputs
- Memoized filtered lists
- Efficient re-render prevention

---

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

## Known Limitations

- Maximum file size: 10MB per PDF
- Supported file type: PDF only
- Chat history not persisted (resets on page refresh)
- No offline functionality

---

## Troubleshooting

### Authentication Issues

**Problem:** "Session expired" message on dashboard

**Solution:** Clear localStorage and log in again
```javascript
// Open browser console (F12) and run:
localStorage.clear();
```

### Connection Errors

**Problem:** "Failed to fetch documents"

**Solution:** 
1. Verify backend is running
2. Check CORS settings in backend
3. Confirm `NEXT_PUBLIC_API_URL` is correct

### Upload Failures

**Problem:** File upload returns 401 error

**Solution:** Token may be expired. Log out and log back in.

---

## Contributing

This is a portfolio project, but contributions are welcome for learning purposes.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -m 'Add new feature'`
4. Push to branch: `git push origin feature/your-feature`
5. Submit a pull request

---

## License

MIT License - See LICENSE file for details

---

## Related Repositories

**Backend API:** [smartdoc-enterprise-api](https://github.com/amrgaberM/smartdoc-enterprise-api)

---

## Contact

**Developer:** Amr Gaber  
**GitHub:** [@amrgaberM](https://github.com/amrgaberM)  
**Backend Repository:** [smartdoc-enterprise-api](https://github.com/amrgaberM/smartdoc-enterprise-api)

---

## Acknowledgments

- Next.js team for the excellent React framework
- Vercel for hosting platform
- Tailwind CSS for utility-first styling
- Anthropic for Claude API integration guidance