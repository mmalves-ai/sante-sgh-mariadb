# ADR 0003: cobertura melhorada (não paridade) e conector só por comando do administrador

**Status:** aceito. **Data:** 2026-11-20. **Decisão do dono.**

## Contexto

O roteiro chamava a F3 de "paridade com o SPDATA" e punha a homologação, a virada e os recursos novos em
sequência depois dela. O risco é terminar com um sistema que repete o SPDATA ("SPDATA-like") e com recursos
novos atrasados pela virada de um hospital.

## Decisões

1. **A F3 é cobertura funcional melhorada.**
   - O sistema novo faz tudo o que o SPDATA fazia, e o SPDATA é só a **lista mínima** do que fazer.
   - O desenho é próprio, e o que o MV faz a mais ou melhor entra **no próprio módulo**.
   - Valem as boas práticas e as normas da área.
   - Cada módulo passa por uma revisão adversarial contra o "com cara de SPDATA".
2. **A F8 cobre só o que não tem equivalente no SPDATA** (operadora, gestão pública, BI e outros) e **não
   espera a virada** de nenhum hospital.
3. **A obra constrói o produto inteiro.** Homologação e virada são operações de cada hospital. A obra entrega
   as ferramentas (F5).
4. **O conector só roda por comando do administrador da plataforma,** sobre um cliente **criado zerado** pelo
   "criar novo cliente". A ProntoCardio é criada assim. A importação (dia 0), cada diferencial e a liberação
   da gravação são comandos explícitos, todos registrados.

## Consequências

- `docs/fases/F3-paridade.md` passou a ser `F3-cobertura-melhorada.md`, e as fichas F4, F8 e o README foram
  ajustados.
- Toda ficha de módulo da F3 traz três listas:
  - lista mínima do SPDATA, 100% coberta;
  - melhorias;
  - recursos do MV.
