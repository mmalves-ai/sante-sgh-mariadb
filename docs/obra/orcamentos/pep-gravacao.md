# Orçamento: pep-gravacao

estimativa_M: 38.6
teto_M: 50

- **Medido em 23/11, 23h40 (inventário do orquestrador):** as portas próprias do PEP ligadas em 349ce50c ainda recusam
  108 métodos (registro 17, documentos 54, prescrição 37), e `podeGravar` devolve sempre `pode:false` nas três: o
  registro clínico, a prescrição e os documentos só abrem em consulta no banco próprio.
- **Rodada:** 7 famílias em linha de produção (construtor → revisor adversarial → corretor), cada uma num ARQUIVO
  PRÓPRIO (`<porta>-propria-<familia>.ts`, funções sobre (nucleo, cliente, ...)), sem editar o `*-porta-propria.ts`;
  o integrador troca os métodos pendentes pelas chamadas e liga o `podeGravar` real. Migrações em 06_PEP com número
  por família (93 registro, 94 prescrição-catálogo, 95 prescrição-gravação, 96 documentos-painel, 97
  documentos-exames-anexos-TCLE, 98 documentos-pareceres-sumários-óbito, 99 alergias).
- **Decisão do orquestrador (alergias, segurança do paciente):** a leitura mostra TODA alergia do paciente, inclusive
  a de descrição livre sem alérgeno cadastrado (o tipo de leitura passa a aceitar agente opcional + descrição livre),
  nunca esconde. O alcance por estabelecimento segue a porta de memória e as regras de acesso entre hospitais já
  existentes.
- **Agentes:** 7 construtores × 2,5 M = 17,5; 7 revisores × 0,6 = 4,2; 7 corretores × 1,0 = 7; integrador 1 × 3,5.
  Soma 32,2 M × 1,2 = **38,6 M**; teto **50 M**.
