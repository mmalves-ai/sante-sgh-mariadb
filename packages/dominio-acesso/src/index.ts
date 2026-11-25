// Regras puras do módulo acesso (M05, M06). Sem Nest, banco ou HTTP (convencoes.md §3).
export * from './politica-senha.js';
export * from './tempo-sessao.js';
export * from './reautenticacao.js';
export * from './tentativas.js';
export * from './termo.js';
export * from './totp.js';
// M06: catálogo gerado da árvore do legado, concessão, CASL, decisão, segregação, vínculo e emergência.
export * from './catalogo.js';
export * from './prova-grupos.js';
export * from './mapa-grupos.js';
export * from './mapa-origem.js';
export * from './concessao.js';
export * from './segregacao.js';
export * from './ability.js';
export * from './decisao.js';
export * from './vinculo.js';
export * from './emergencia.js';
// ADR 0021: suporte técnico e "login como" (regras de quem entra e onde; cifra das contas da plataforma).
export * from './suporte.js';
export * from './cifra-plataforma.js';
// M10: login como chave, árvore de opções para a tela, proposta do mapa grupo → perfil, segregação nas telas de
// acesso, período da trilha e pedidos do titular.
export * from './usuario/login.js';
export * from './usuario/segregacao-gestao.js';
export * from './usuario/ultimo-gestor.js';
export * from './usuario/painel-cpf.js';
export * from './usuario/contas-dormentes.js';
export * from './usuario/recertificacao.js';
export * from './catalogo/reconstrucao-arvore.js';
export * from './mapa/grupo-perfil.js';
export * from './auditoria/periodo.js';
export * from './privacidade/pedido-titular.js';
// W0-10 (M2): cópia do prontuário (fila de atos, legitimidade, PDF com marca d'água).
export * from './privacidade/copia-prontuario.js';
export * from './privacidade/copia-pdf.js';
// M50 etapa 1: conta do portal do paciente, responsável legal e o que o portal mostra (consentimentos, pedidos, acessos).
export * from './portal/conta.js';
export * from './portal/vinculo.js';
export * from './portal/privacidade.js';
// M59-F1: contas do banco (inventário, destino por conta) e privilégio mínimo por módulo (plano, desvios, scripts).
export * from './contas/inventario.js';
export * from './contas/privilegio-minimo.js';
export * from './contas/alcance.js';
export * from './contas/painel.js';
// M59-F2: credencial forte, retirada da senha antiga e política do segundo fator.
export * from './identidade/credencial-forte.js';
export * from './politica-2fa.js';
// M59-F4: saneamento dos grupos de acesso amplo (simulador, sugestão, decisões e dissolução).
export * from './saneamento.js';
// M59-F3: imutabilidade clínica por privilégio, segredos de parceiros e senhas secundárias.
export * from './imutabilidade/imutabilidade.js';
export * from './segredos/segredos.js';
// M59-F5: termo das concessões, ciclos de avaliação SBIS, pacote de evidências, backup verificado e prova da trilha.
export * from './sbis/concessoes.js';
export * from './sbis/ciclos.js';
export * from './sbis/pacote.js';
export * from './sbis/backup.js';
export * from './sbis/trilha.js';
export * from './usuario/pedido-acesso.js';
export * from './usuario/tarefas-rh.js';
export * from './usuario/troca-rapida.js';
export * from './usuario/conselho.js';
export * from './usuario/usuario-modelo.js';
export * from './usuario/cadastro-usuario.js';
export * from './usuario/credencial-inicial.js';
export * from './usuario/vinculo-estabelecimento.js';
export * from './preferencias/preferencias-usuario.js';
export * from './notificacao/notificacao-regra.js';
export * from './notificacao/email-configuracao.js';
export * from './notificacao/email-saida.js';
