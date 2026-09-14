# DoseFinder - Web-based Hospital Application

DoseFinder is a comprehensive, production-ready enterprise hospital application designed to streamline patient operations, automate medical dosage calculations, and provide real-world hospital workflows. The platform is reinforced with an advanced AI Chatbot and a robust backend system architecture built to scale.

## Key Features
- **AI-Powered Medical Chatbot:** Integrated virtual assistant to handle patient inquiries, guide interactions, and enhance user experience.
- **Advanced Dosage Calculator:** Dynamic system logic designed to calculate accurate medical dosages based on specific input metrics.
- **Smart Hospital Navigation:** Comprehensive dashboard for patients and medical staff to navigate hospital operations seamlessly.
- **Microservices & Containerization:** Fully containerized environment using **Docker** and **Docker Desktop** for multi-service reliability (Frontend, Backend, Admin Portal, Database, and Search layers).

## Tech Stack & Architecture
- **Back-End Core:** Powered by robust service logic (utilizing languages/frameworks like Python/Java/.NET environments).
- **Front-End Interfaces:** Responsive, user-centered web panels built with HTML5, CSS3, JavaScript, and Figma prototypes.
- **Infrastructure & Containerization:** Multi-container deployment managed via **Docker Compose** including:
  - `dms-frontend` & `dms-admin-frontend`
  - `dms-backend` & `dms-drug-api`
  - `mysql:8.0` (Relational Database)
  - `meilisearch` (High-performance search engine)
  - `ollama` (Local LLM orchestration for the AI chatbot)

## System Architecture Overview
The application follows a distributed architecture ensuring strict isolation between the user portals, administration configurations, and automated medical APIs:
- **`frontend` / `admin-frontend`:** User interface layer bridging user flows to core logic.
- **`backend` / `drug-api`:** Handles business logic, algorithmic routing for dosages, and secure database transitions.
- **Data Layers:** Asynchronous database syncing using MySQL, cached/indexed utilizing Meilisearch for instant queries.

##  Team Contributions
Developed by a dedicated team of 6 engineers. 
- *My Primary Focus:* Architecting back-end application workflows, driving business log calculations, environment configurations, and integrating clean frontend user-experiences.

##  Development & Local Setup
To spinning up the entire development environment locally, ensure you have **Docker Desktop** installed, then execute:

```bash
# Clone the repository
git clone [https://github.com/Marwan2025S/DoseFinder.git](https://github.com/Marwan2025S/DoseFinder.git)

# Navigate to project directory
cd dms

# Build and start all multi-container services
docker compose up -d --build
# DoseFinder - Web-based Hospital Application

DoseFinder is a comprehensive, production-ready enterprise hospital application designed to streamline patient operations, automate medical dosage calculations, and provide real-world hospital workflows. The platform is reinforced with an advanced AI Chatbot and a robust backend system architecture built to scale.

## Key Features
- **AI-Powered Medical Chatbot:** Integrated virtual assistant to handle patient inquiries, guide interactions, and enhance user experience.
- **Advanced Dosage Calculator:** Dynamic system logic designed to calculate accurate medical dosages based on specific input metrics.
- **Smart Hospital Navigation:** Comprehensive dashboard for patients and medical staff to navigate hospital operations seamlessly.
- **Microservices & Containerization:** Fully containerized environment using **Docker** and **Docker Desktop** for multi-service reliability (Frontend, Backend, Admin Portal, Database, and Search layers).

## Tech Stack & Architecture
- **Back-End Core:** Powered by robust service logic (utilizing languages/frameworks like Python/Java/.NET environments).
- **Front-End Interfaces:** Responsive, user-centered web panels built with HTML5, CSS3, JavaScript, and Figma prototypes.
- **Infrastructure & Containerization:** Multi-container deployment managed via **Docker Compose** including:
  - `dms-frontend` & `dms-admin-frontend`
  - `dms-backend` & `dms-drug-api`
  - `mysql:8.0` (Relational Database)
  - `meilisearch` (High-performance search engine)
  - `ollama` (Local LLM orchestration for the AI chatbot)

## System Architecture Overview
The application follows a distributed architecture ensuring strict isolation between the user portals, administration configurations, and automated medical APIs:
- **`frontend` / `admin-frontend`:** User interface layer bridging user flows to core logic.
- **`backend` / `drug-api`:** Handles business logic, algorithmic routing for dosages, and secure database transitions.
- **Data Layers:** Asynchronous database syncing using MySQL, cached/indexed utilizing Meilisearch for instant queries.

## Team Contributions
Developed by a dedicated team of 6 engineers. 
- *My Primary Focus:* Architecting back-end application workflows, driving business log calculations, environment configurations, and integrating clean frontend user-experiences.

##  Development & Local Setup
To spinning up the entire development environment locally, ensure you have **Docker Desktop** installed, then execute:

```bash
# Clone the repository
git clone [https://github.com/Marwan2025S/DoseFinder.git](https://github.com/Marwan2025S/DoseFinder.git)

# Navigate to project directory
cd dms

# Build and start all multi-container services
docker compose up -d --build
