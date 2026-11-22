# Orçamento: senha-ui

estimativa_M: 3
teto_M: 4

- **Objetivo:** a troca de senha (plataforma e cliente) mostra as regras da política antes, confere cada regra ao vivo
  e destaca o motivo da recusa vindo da API; a API registra cada recusa (rota, status, código da regra; nunca a senha).
- **Agentes:** 1 construtor avulso, roteiro de 15 a 40 turnos (2,5 M) × 1,2 = 3 M; teto 4 M.
- **Origem:** o dono trocou a senha do admin da plataforma e só viu "a senha nova não foi aceita", sem destaque e sem
  dizer a regra (a política recusa senha que contém o login).
