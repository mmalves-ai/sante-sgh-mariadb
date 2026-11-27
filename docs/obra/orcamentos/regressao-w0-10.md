# Orçamento: regressao-w0-10 (27/11 06h10)

O E2E apps/web/e2e/w0-10-medico.spec.ts (portal do médico externo: conta e pedido de cirurgia) caiu 0/4 no commit
5a633cec, todos no cadastro do segundo fator: getByTestId('medico-otpauth').locator('code') não aparece (e um no
campo-login). Achado ao rodar o m26 e o w0-10 para o C3-003. Provável efeito das mudanças do segundo fator (C3-009,
chave de dispositivo; métodos do segundo fator). Um agente, correção na causa, prova por E2E.

estimativa_M: 1
teto_M: 1.5
