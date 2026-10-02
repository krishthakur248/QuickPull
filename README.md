<div align="center">

# 🚗 QuickPull

### Share the journey. Make every ride count.

QuickPull is a ride-sharing experience that brings drivers and riders going the same way together. Explore available trips, offer a ride, follow trip activity on a map, and stay connected with real-time updates.

<br />

<a href="https://krishthakur248.github.io/QuickPull/"><strong>🌐 Live Demo</strong></a>
&nbsp; · &nbsp;
<a href="#-getting-started">Get Started</a>
&nbsp; · &nbsp;
<a href="#-project-structure">Project Structure</a>

<br /><br />

![HTML](https://img.shields.io/badge/HTML5-frontend-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=222)
![Node.js](https://img.shields.io/badge/Node.js-backend-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-database-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?style=for-the-badge&logo=socketdotio&logoColor=white)

</div>

---

## ✨ What you can do

| 🧭 Find a ride | 🚘 Offer a ride |
|:---|:---|
| Browse available trips, review ride details, and request to join a trip. | Share your route and manage rider requests for your trip. |

| 🗺️ Follow trip activity | 💬 Stay connected |
|:---|:---|
| View rides and trip locations on an interactive map. | Use trip messaging and live updates supported by the backend. |

| 👤 Manage your account | 📱 Use it on the go |
|:---|:---|
| Register, sign in, and manage profile details. | Responsive pages adapt to mobile and desktop screens. |

## 🧰 Built with

- **Frontend:** HTML, CSS, and JavaScript
- **Maps:** Leaflet
- **Backend:** Node.js, Express, and Socket.IO
- **Data and authentication:** MongoDB with Mongoose, JWT, and bcryptjs
- **Routing/matching utilities:** OSRM, Turf.js, and H3
- **Hosting:** GitHub Pages for the demo; the frontend is configured to use the deployed API

## 🚀 Getting started

### Try the live demo

Open [QuickPull on GitHub Pages](https://krishthakur248.github.io/QuickPull/). The frontend is configured to connect to the hosted API.

**Demo account**

| Email | Password |
|:---|:---|
| `a@gmail.com` | `12345678` |

### Run the frontend locally

1. Clone the repository and open its folder:

   ```bash
   git clone https://github.com/krishthakur248/myrepo.git
   cd myrepo
   ```

2. Serve the repository root over HTTP with your preferred static web server (for example, the VS Code **Live Server** extension).
3. Open the local site address and start at `index.html`.

The connected frontend uses the API URL in [`api-config.js`](api-config.js). To use a locally running backend instead, change `RENDER_SERVER_URL` there to `http://localhost:5000` before launching the frontend.

### Run the backend locally

You will need **Node.js**, **npm**, and a reachable **MongoDB** database.

1. Install backend dependencies:

   ```bash
   cd car-pulling-backend
   npm install
   ```

2. Create `car-pulling-backend/.env` with your own local configuration:

   ```dotenv
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://127.0.0.1:27017/quickpull
   JWT_SECRET=replace-with-a-long-random-secret
   JWT_EXPIRE=7d
   CORS_ORIGIN=http://127.0.0.1:5500
   ```

   Use a private, strong `JWT_SECRET`; do not commit `.env` or production credentials. `MONGODB_URI` and `JWT_SECRET` must be set for database access and authentication.

3. Start the server:

   ```bash
   npm run dev
   ```

   For a normal start without automatic reload:

   ```bash
   npm start
   ```

4. Check the API at [`http://localhost:5000/api/health`](http://localhost:5000/api/health).

## 🗂️ Project structure

```text
QuickPull/
├── index.html                   # Landing page and account entry
├── Dashboard-Connected.html     # Ride dashboard and map
├── AddRide-Connected.html       # Offer-a-ride flow
├── api-config.js                # Frontend API and Socket.IO URLs
├── api-client.js                # Shared HTTP client
├── auth-service.js              # Authentication helpers
├── trip-service.js              # Trip operations
├── trip-service-api.js          # Trip API helpers
├── matchingService.js           # Ride matching helpers
├── message-service.js           # Messaging helpers
├── notification-manager.js      # Notifications
├── Disn/                        # UI screenshots
├── Testing/                     # Additional ride, route, and login pages
└── car-pulling-backend/
    ├── src/
    │   ├── config/              # Database connection
    │   ├── controllers/         # Request handlers
    │   ├── middleware/          # Authentication middleware
    │   ├── models/              # User, Trip, and Message models
    │   ├── routes/              # API routes
    │   ├── utils/               # Matching and route utilities
    │   └── server.js            # Express and Socket.IO server
    └── package.json
```

## 🔌 Backend overview

The API is grouped under `/api`:

| Area | Base path | Examples |
|:---|:---|:---|
| Authentication | `/api/auth` | Register, login, profile, and account verification |
| Users | `/api/users` | Driver details, nearby drivers, and ratings |
| Trips | `/api/trips` | Start a trip, find matches, join, and complete |
| Messages | `/api/messages` | Send and retrieve trip messages |
| Health | `/api/health` | API status check |

The Socket.IO server supports trip and user rooms, location updates, and messaging for connected clients.

## 📄 License

The backend package declares the **MIT** license. See [`car-pulling-backend/package.json`](car-pulling-backend/package.json).

---

<div align="center">

**Ready to share a ride?** &nbsp; [Open the QuickPull demo →](https://krishthakur248.github.io/QuickPull/)

</div>
