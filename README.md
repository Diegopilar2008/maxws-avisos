# MAXWS · robô de notificações

Este repositório manda as notificações do app **MAXWS** (https://max-ws.web.app).

- A cada 5 minutos o GitHub roda o `avisos.js`.
- Ele procura no Firebase quem tem lembrete de hábito naquele horário e manda a notificação para o celular.
- Às 20h avisa quem ainda tem hábitos pendentes no dia.
- Avisa o dono quando alguém se cadastra.

A chave do Firebase fica guardada no segredo `FIREBASE_SA` (Settings → Secrets and variables → Actions). Ela nunca aparece no código.

Para testar na hora: aba **Actions** → **MAXWS avisos** → **Run workflow**.
