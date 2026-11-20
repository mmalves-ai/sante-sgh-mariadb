# F8. Recursos novos sem equivalente no SPDATA

**Objetivo:** os recursos e módulos que o MV (ou a boa prática) tem e que **não se encaixam em nenhum
módulo da F3**, por não terem nada parecido no SPDATA. Exemplos: operadora de plano próprio, gestão pública,
indicadores e BI, portal do paciente, telemedicina, apoio à decisão clínica.

As melhorias do MV dentro de módulos que o SPDATA já tinha **não esperam a F8**: entram na própria F3.

**Entra:** F2 e o módulo base de que o recurso depende. **Não depende da virada de nenhum hospital.**
**Sai:** a cobertura funcional completa contra a matriz da F1. Cada recurso fecha com ficha, contrato de
efeito, telas e E2E.

---

## Como cada recurso entra

1. **Origem:** as seções de recursos novos de `docs/analise/` e o que a revisão "sem cara de SPDATA" da F3
   mandar para cá.
2. **Ficha do recurso,** escrita **com palavras próprias**, com:
   - problema de negócio;
   - quem usa;
   - regras;
   - entidades novas ou alteradas no modelo próprio;
   - padrões públicos aplicáveis.
3. **Sem cópia.** Nada de nomes, colunas ou descritivos do MV no modelo, no código ou nas telas. O
   verificador de nomes proibidos roda na esteira.
4. **Ordem** por valor para o hospital e esforço. O dono pode reordenar a qualquer momento.

## Fila inicial

Sai da F1.1, nas seções de recursos novos de cada grupo, e corre em paralelo com a F3 a partir do momento em
que o módulo base existir.
