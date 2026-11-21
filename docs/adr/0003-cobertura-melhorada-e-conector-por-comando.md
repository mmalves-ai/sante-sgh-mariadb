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

## Complemento do dono (2026-11-21)

5. **A coexistência sai do produto.** O sistema novo nunca grava no Firebird. O módulo `coexistencia`, que
   veio do `new-sgh`, é **removido**, não migrado. O código continua no histórico do git.
6. **A carga é o conector, e só por comando do administrador da plataforma.** O fluxo é:
   1. o administrador cria o cliente novo, zerado (por exemplo, a ProntoCardio);
   2. aponta a base Firebird de origem;
   3. dispara a **carga inicial**;
   4. depois, quantas vezes quiser, dispara o **diferencial**, que traz o que mudou entre a última carga e o
      momento atual. Isso vale também para a entrada em operação, depois da aprovação e da checagem da equipe
      do hospital.

   O módulo `carga` da API é **aproveitado como insumo do conector (F4)**, e não migrado como módulo comum. O
   disparo fica na administração da plataforma, e a leitura do Firebird fica só no `conector/` (AGENTS, regra
   3).

## Correção do dono (2026-11-21): é um painel, não linha de comando

7. **Tudo pelo painel de administração da plataforma,** no navegador, logado como administrador da plataforma:
   1. **Criar o cliente.** Gera o banco novo, só dele. Exemplo: ProntoCardio.
   2. **Indicar, se quiser, o banco Firebird legado,** apontando para o arquivo.
   3. **Clicar em "Importar"** (primeira vez) ou **"Sincronizar"** (já importado, diferencial). O sistema
      importa do Firebird indicado. O painel mostra o progresso, as pendências e a conciliação.

   - O conector é o **motor** que o painel aciona.
   - A linha de comando existe só como ferramenta interna de teste. Nunca é o fluxo do dono.
   - O arquivo apontado **nunca é alterado nem copiado inteiro** (regra 4).

8. **Onboarding genérico (dono, 2026-11-21).** A ProntoCardio é só o primeiro cliente.
   - O painel atende **quantos clientes o administrador quiser criar**.
   - Cada cliente tem o seu banco. Pode apontar o seu próprio arquivo Firebird, ou nenhum, e importar ou
     sincronizar de forma independente.
   - Só uma execução por cliente de cada vez. Clientes diferentes podem rodar em paralelo, até o limite da
     máquina.
   - O isolamento entre clientes é total.
   - Nada é fixo para nenhum cliente: nem nome, nem caminho, nem mapeamento.

9. **Sem migração parcial (dono, 2026-11-21).** Com banco separado, não há convivência por setor, liberação
   gradual de telas nem vigilância de gravação no banco antigo. Os módulos `coexistencia` e `onda0` e a
   verificação de convivência da implantação saem do produto. A passagem de um hospital é inteira, pelo painel.
