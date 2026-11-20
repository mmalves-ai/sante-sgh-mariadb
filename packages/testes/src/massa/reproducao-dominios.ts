// Reprodução dos cenários da receita genérica do CRUD genérico (M08, seção 9) pelo EXECUTOR, na transação
// da captura (sempre desfeita). A preparação acontece antes do retrato "antes" e usa o próprio executor:
//   incluir/novo              — item sintético com todos os campos da declaração;
//   incluir/recusa-duplicado  — mesma descrição de um item ativo existente (nada gravado: 409 duplicado);
//   alterar/descricao (ou campos-editaveis) — muda todos os campos editáveis de um item ativo existente;
//   alterar/recusa-colisao    — o item muda "por fora" (pelo executor) depois da leitura: 409 conflito-versao;
//   alterar/limpa-<campo>     — M24: só o campo com a sentinela do legado deixado vazio (grava a sentinela);
//   inativar/sem-uso          — item sintético (incluído na preparação, sem uso) inativado;
//   inativar/recusa-colisao   — item sintético alterado por fora depois da leitura: 409 conflito-versao.
//   reativar/reativa          — W0-02: item sintético (ou sem uso) inativado na preparação, reativado com o motivo;
//   reativar/recusa-ja-ativo  — W0-02: item ativo: 409 ja-ativo, nada gravado;
//   excluir/nunca-usado       — W0-02: item sintético incluído na preparação, sem uso, excluído com o motivo;
//   excluir/recusa-com-dependentes — W0-02: item com uso pelas FKs: 409 com-dependentes, nada apagado.
//   alterar/texto-longo       — W0-02: os textos longos editáveis com acentuação CP1252 e mais de 64 KiB (segmentos).
// Os itens existentes são dados de referência (descrições de domínio), lidos só em memória; o generator anda
// só no `novo` e nas inclusões da preparação da inativação (GEN_ID não volta com o ROLLBACK).
import { type DeclaracaoDominio, operacaoDoDominio, type ValorCampo } from '@sgh/contratos';
import {
  type CenarioCaptura,
  criarDispositivo,
  DECLARACOES,
  ErroOperacao,
  type Escritor,
  itemDoDominio,
  usoDoItem,
} from '@sgh/legado';
import {
  codigoLivre,
  itemAtivoOuNulo,
  SemOpcaoLivre,
  itemAtivoSemUso,
  valoresDeAlteracao,
  valoresDeInclusao,
} from './dominios.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;

/**
 * W0-02: texto longo sintético (acima de 64 KiB, mais de um segmento de BLOB) só com caracteres do CP1252/WIN1252
 * acentuados, para gravar e reler idêntico.
 */
export function textoLongoCp1252(): string {
  return `Respostas com acentuação: ção, ã, é, ü, ¿, “aspas”, € — ${'linha de texto longo áéíóú ÇÑ ºª\n'.repeat(2400)}`;
}
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/**
 * M10: tabelas em que o gatilho do legado recusa trocar o nome de item já usado (TBCLINICA, TBLOCCON: e_*1) ou em
 * que a troca de nome retrata os leitos do item (RIBLOCOS → HTLEITO, número variável): a alteração reproduz sobre
 * um item sintético incluído na preparação (sem uso, sem leitos), como a inativação.
 */
// M24: o mesmo para a fórmula, o item não padronizado e os domínios das interações (o *_BU recusa trocar o nome
// já usado: e_integridade_pep, e_tbclassintmed1 e afins).
const ALTERAR_SOBRE_ITEM_NOVO = new Set([
  'TBCLINICA',
  'TBLOCCON',
  'RIBLOCOS',
  'PRFORMULA',
  'PRITEMNAOPAD',
  'TBCLASSINTMED',
  'TBGRAUGRAVINT',
  'TBPROBOCINTMED',
]);

/**
 * M10: domínios sem inclusão pelo novo (a linha nasce com dados de outra área) e sem item livre de uso no pc: o
 * item da reprodução é incluído POR FORA na transação desfeita (como o outro sistema faria), só com as colunas
 * obrigatórias e marcas sintéticas; a operação sob teste (alterar ou inativar) roda sobre ele.
 */
const ITEM_POR_FORA: Readonly<Record<string, (e: Escritor, d: DeclaracaoDominio) => Promise<string>>> = {
  TBUNIDAD: async (e, d) => {
    const cod = Number(await codigoLivre(e, d));
    await e.executar(`INSERT INTO TBUNIDAD (COD, NOME, SITUACAO) VALUES (?, ?, 'A')`, [
      cod,
      `SGH M10 UNIDADE ${cod}`,
    ]);
    return String(cod);
  },
  TBCENCUS: async (e) => {
    // Código na faixa de SMALLINT (as FKs que apontam para TBCENCUS.COD incluem colunas SMALLINT: um código
    // acima disso estoura na conferência de uso da inativação).
    const usados = new Set(
      (await e.consultar('SELECT COD FROM TBCENCUS', [], { teto: 5_000 })).map((x) => Number(x['COD'])),
    );
    let cod = 32_767;
    while (usados.has(cod)) cod--;
    await e.executar(`INSERT INTO TBCENCUS (COD, NOME, SITUACAO) VALUES (?, ?, 'A')`, [
      cod,
      `SGH M10 CC ${cod}`,
    ]);
    return String(cod);
  },
  TBLOCAL: async (e) => {
    const [r] = await e.consultar('SELECT FIRST 1 ID FROM TBRECEPCAO ORDER BY ID', [], { teto: 1 });
    const l = await e.executarRetornando(
      `INSERT INTO TBLOCAL (ID, ID_TBRECEPCAO, COD, DESCRICAO, ATIVO, PERMITE_ENC, PAINEL_WEB) VALUES (0, ?, 9999, 'SGH M10 LOCAL', 'T', 'F', 'F') RETURNING ID`,
      [Number(r?.['ID'])],
    );
    return String(l['ID']);
  },
};

/**
 * M24: a chave que aponta para outro cadastro sem opção livre (todo bloco já tem regra de vigência): na inclusão, um
 * item sintético entra no cadastro das opções pelo executor (o domínio declarado dele), na mesma transação desfeita;
 * na recusa, basta a combinação de um item existente (a cópia dela vem depois).
 */
async function valoresDeInclusaoComOpcao(
  e: Escritor,
  d: DeclaracaoDominio,
  executarOutra: ExecutarOutra,
  recusa: boolean,
): Promise<Record<string, ValorCampo>> {
  try {
    return await valoresDeInclusao(e, d);
  } catch (x) {
    if (!(x instanceof SemOpcaoLivre) || (!x.tabelaOpcoes && !x.dominioOpcoes)) throw x;
    const alvo = DECLARACOES.find(
      (y) =>
        (x.tabelaOpcoes !== null && y.tabela === x.tabelaOpcoes) ||
        (x.dominioOpcoes !== null && `${y.publico.modulo}.${y.publico.recurso}` === x.dominioOpcoes),
    );
    if (!alvo) throw x;
    if (recusa) {
      const existente = await itemAtivoOuNulo(e, d);
      if (!existente) throw x;
      return { ...existente.valores };
    }
    await executarOutra(e, operacaoDoDominio(alvo.publico, 'incluir'), await valoresDeInclusao(e, alvo));
    return valoresDeInclusao(e, d);
  }
}

/**
 * W1-04: domínios sem item com uso na cópia que se possa excluir (o motivo de exclusão não tem uso; a procedência só tem
 * o 0, item de sistema): a recusa da exclusão roda sobre o item sintético da preparação, com UM registro dependente
 * sintético incluído POR FORA na transação desfeita (só as colunas obrigatórias), numa tabela que liga só por código
 * (referência lógica do mapa de dependências da recepção) e sem gatilho — nenhum dado de paciente é tocado.
 */
const DEPENDENTE_POR_FORA: Readonly<Record<string, (e: Escritor, codigo: string) => Promise<void>>> = {
  // COPIAFCRECIBO.ID_TBMOTEXC (sem FK, sem gatilho): a cópia do recibo cancelado com o motivo.
  TBMOTEXC: async (e, codigo) => {
    await e.executar(
      `INSERT INTO COPIAFCRECIBO (ID, REC, TIPO_CTA, CONTA, REF, ID_TBMOTEXC)
       SELECT COALESCE(MAX(ID), 0) + 1, 0, 'E', 0, 0, ? FROM COPIAFCRECIBO`,
      [Number(codigo)],
    );
  },
  // SICADATE_EXCLUSAO.PROCEDENCIA (cópia do atendimento de exame excluído; sem FK, sem gatilho): a linha sintética só com
  // as colunas obrigatórias, sem paciente (a transfusão, SHTRANS, tem gatilho que exige o profissional).
  TBPROCED: async (e, codigo) => {
    await e.executar(
      `INSERT INTO SICADATE_EXCLUSAO (ID, ID_SICADATE, REG, CONTA, ATEND, CONV, ID_ATCABECATEND, PROCEDENCIA)
       SELECT COALESCE(MAX(ID), 0) + 1, 0, 0, 0, 'E', 0, 0, ? FROM SICADATE_EXCLUSAO`,
      [Number(codigo)],
    );
  },
  // W1-04 (parte 4): o painel de TV sintético ganha UM dispositivo de painel de TV (SGH_ACESSO_DISPOSITIVO, tabela do
  // novo) apontando a ordem dele, criado pelo mesmo criarDispositivo da tela (PORTAL_ORDEM; PORTAL_CONFIG nulo).
  PNCONFIGPORTAL: async (e, codigo) => {
    const ordem = Number(codigo.split('|')[1]);
    await criarDispositivo(e, {
      hospital: e.hospital,
      tipo: 'paineltv',
      nome: 'SGH W1-04 TV',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: null,
      portalOrdem: ordem,
      usuarioLegado: null,
      voz: false,
      validadeDias: 1,
      usuario: 'SGH',
    });
  },
};

/** W0-02: um item do domínio com uso pelas FKs do catálogo (a recusa da exclusão), ou null. */
async function itemComUso(e: Escritor, d: DeclaracaoDominio): Promise<string | null> {
  const lista = await e.consultar(
    `SELECT FIRST 50 ${(d.chaveComposta ?? [d.chave]).join(', ')} FROM ${d.tabela} ORDER BY 1`,
    [],
    { teto: 50 },
  );
  // W1-05: além das FKs (que a chave composta não tem), as referências lógicas da declaração (o título e as seleções
  // guardam o modelo da ficha só por COD e GRAFICA).
  const refs = d.exclusao?.referenciasLogicas ?? [];
  const chaves = d.chaveComposta ?? [d.chave];
  // W1-04: o item de sistema (protegido) é recusado antes dos dependentes: não serve à recusa por dependentes.
  const sistema = new Set(
    (d.situacao?.protegidas?.codigos ?? d.situacaoSoNoNovo?.protegidas ?? []).map(String),
  );
  for (const l of lista) {
    const codigo = chaves.map((k) => String(l[k] ?? '').trim()).join('|');
    if (sistema.has(codigo)) continue;
    if ((await usoDoItem(e, d, codigo)).some((u) => u.usos)) return codigo;
    for (const r of refs) {
      const onde = r.colunas.map((c) => `${c} = ?`).join(' AND ');
      const [x] = await e.consultar(
        `SELECT FIRST 1 1 U FROM ${r.tabela} WHERE ${onde}`,
        chaves.map((k) => l[k]),
        { teto: 1 },
      );
      if (x !== undefined) return codigo;
    }
  }
  return null;
}

export function declaracaoDaOperacao(nome: string): {
  d: DeclaracaoDominio;
  verbo: 'incluir' | 'alterar' | 'inativar' | 'reativar' | 'excluir';
} {
  for (const d of DECLARACOES) {
    for (const verbo of ['incluir', 'alterar', 'inativar', 'reativar', 'excluir'] as const) {
      if (operacaoDoDominio(d.publico, verbo) === nome) return { d, verbo };
    }
  }
  throw new Error(`${nome}: não é operação do CRUD genérico.`);
}

export function cenarioDeDominio(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  _c: unknown,
  executar: Executar,
  executarOutra: ExecutarOutra,
): CenarioCaptura {
  const { d, verbo } = declaracaoDaOperacao(nome);
  let entrada: unknown = null;
  const incluir = operacaoDoDominio(d.publico, 'incluir');
  const alterar = operacaoDoDominio(d.publico, 'alterar');
  const recusa = cenario.startsWith('recusa-');
  /** Item sintético incluído pelo executor (preparação); devolve o código. */
  const incluirSintetico = async (e: Escritor) => {
    const r = await executarOutra(e, incluir, await valoresDeInclusao(e, d));
    return String(r.resultado['codigo']);
  };
  return {
    ...base,
    async preparar(e) {
      if (verbo === 'incluir') {
        const valores = await valoresDeInclusaoComOpcao(e, d, executarOutra, recusa);
        if (recusa) {
          // Copia o primeiro conjunto único de um item ativo existente (a descrição, e o sexo no estado civil).
          // M14: a tabela que só tem a sentinela ganha antes um item sintético (incluído pelo executor).
          // M14: só um conjunto que a inclusão digita (o índice único de coluna fora da inclusão não serve).
          const digitados = d.unico.filter((u) =>
            u.every((campo) => d.colunas.some((c) => c.campo === campo && c.naInclusao)),
          );
          const conjunto = digitados[digitados.length - 1] ?? [d.descricao];
          // M24: o item ativo com o conjunto vazio (ex.: local de assistência sem nome) não serve de modelo da
          // duplicidade; vale um item sintético incluído pelo executor.
          const ativo = await itemAtivoOuNulo(e, d);
          const existente =
            ativo && conjunto.every((campo) => (ativo.valores[campo] ?? '') !== '')
              ? ativo
              : await itemDoDominio(e, d, await incluirSintetico(e));
          if (!existente) throw new Error(`${d.tabela}: item da preparação não relido.`);
          for (const campo of conjunto) valores[campo] = existente.valores[campo] ?? null;
          // Chave composta digitada: a recusa é pela chave do item existente (mesma combinação).
          if (d.chaveComposta && (d.unico.length === 0 || d.unico.every((u) => u.length === 0)))
            for (const k of d.chaveComposta) {
              const c = d.colunas.find((x) => x.coluna === k);
              if (c) valores[c.campo] = existente.valores[c.campo] ?? null;
            }
        }
        entrada = valores;
        return;
      }
      // W0-02: reativar (item inativado na preparação) e excluir (item nunca usado; ou um item com uso, na recusa).
      if (verbo === 'reativar' || verbo === 'excluir') {
        const semInclusaoW = !d.publico.acoes.includes('criar');
        const porForaW = ITEM_POR_FORA[d.tabela];
        let codigo: string;
        if (verbo === 'excluir' && cenario === 'recusa-com-dependentes') {
          const comUso = await itemComUso(e, d);
          const dependente = DEPENDENTE_POR_FORA[d.tabela];
          if (comUso) codigo = comUso;
          else if (dependente) {
            codigo = await incluirSintetico(e);
            await dependente(e, codigo);
          } else throw new Error(`${d.tabela}: nenhum item com uso para a recusa da exclusão.`);
        } else if (porForaW) codigo = await porForaW(e, d);
        else if (semInclusaoW) codigo = await itemAtivoSemUso(e, d);
        else if (verbo === 'reativar') {
          // A reativação só troca a situação (e é desfeita): sem item sintético possível (a inclusão do cadastro pede
          // um cadastro ligado que a cópia não oferece), vale um item ativo real, inativado e reativado na transação
          // (a inclusão que falha é desfeita pelo ponto de salvamento do próprio executor).
          try {
            codigo = await incluirSintetico(e);
          } catch {
            const real = await itemAtivoOuNulo(e, d);
            if (!real) throw new Error(`${d.tabela}: nenhum item ativo para a reativação.`);
            codigo = real.codigo;
          }
        } else codigo = await incluirSintetico(e);
        let lido = await itemDoDominio(e, d, codigo);
        if (!lido) throw new Error(`${d.tabela}: item da preparação não relido.`);
        if (verbo === 'reativar' && !recusa) {
          const inativar = operacaoDoDominio(d.publico, 'inativar');
          try {
            await executarOutra(e, inativar, { codigo, versao: lido.versao, confirmarEmUso: true });
          } catch {
            // O item sintético com código acima do tipo das colunas que o referenciam (a conferência de uso estoura):
            // vale um item ativo real, inativado e reativado na mesma transação desfeita.
            const real = await itemAtivoOuNulo(e, d);
            if (!real) throw new Error(`${d.tabela}: nenhum item ativo para a reativação.`);
            codigo = real.codigo;
            await executarOutra(e, inativar, { codigo, versao: real.versao, confirmarEmUso: true });
          }
          lido = await itemDoDominio(e, d, codigo);
          if (!lido) throw new Error(`${d.tabela}: item inativado não relido.`);
        }
        // A ligação sem dependente possível: a recusa é a da versão (o item muda por fora depois da leitura, e a
        // entrada leva a versão lida antes, já velha).
        if (verbo === 'excluir' && cenario === 'recusa-colisao') {
          const fora = await valoresDeAlteracao(e, d, lido.valores, codigo);
          await executarOutra(e, alterar, { codigo, versao: lido.versao, valores: fora });
        }
        entrada = {
          codigo,
          versao: lido.versao,
          motivo: verbo === 'reativar' ? 'reproducao W0-02: reativar' : 'reproducao W0-02: excluir',
        };
        return;
      }
      // alterar: item ativo existente; inativar: item sintético sem uso (M11: no domínio sem inclusão, um item
      // ativo existente sem uso pelas FKs, só em memória e na transação desfeita).
      const semInclusao = !d.publico.acoes.includes('criar');
      const porFora = ITEM_POR_FORA[d.tabela];
      // M14: a alteração usa um item ativo real; a tabela que só tem a sentinela (a linha 0 nunca é alterada)
      // ganha um item sintético na preparação, quando o domínio inclui.
      const real =
        verbo === 'alterar' && !ALTERAR_SOBRE_ITEM_NOVO.has(d.tabela) ? await itemAtivoOuNulo(e, d) : null;
      const codigo = porFora
        ? await porFora(e, d)
        : real
          ? real.codigo
          : semInclusao
            ? await itemAtivoSemUso(e, d)
            : await incluirSintetico(e);
      const lido = await itemDoDominio(e, d, codigo);
      if (!lido) throw new Error(`${d.tabela}: item da preparação não relido.`);
      if (recusa) {
        // Alteração "por fora" depois da leitura (outro operador, pelo executor): a versão lida fica velha.
        // M14: domínio sem alteração (o banco recusa mudar os campos): o "por fora" é a inativação do item.
        if (d.publico.acoes.includes('editar')) {
          const fora = await valoresDeAlteracao(e, d, lido.valores, codigo);
          await executarOutra(e, alterar, { codigo, versao: lido.versao, valores: fora });
        } else
          await executarOutra(e, operacaoDoDominio(d.publico, 'inativar'), {
            codigo,
            versao: lido.versao,
            confirmarEmUso: true,
          });
      }
      // M14: o item novo pode ficar em uso pelo que os triggers da inclusão gravam (ex.: equivalências do
      // material): a inativação confirma o uso, como o operador faria.
      const emUso =
        verbo === 'inativar' && !recusa ? (await usoDoItem(e, d, codigo)).some((u) => u.usos) : false;
      // M24: `limpa-<campo>` deixa só aquele campo vazio (a coluna com a sentinela do legado).
      const limpa = cenario.startsWith('limpa-')
        ? (d.colunas.find(
            (c) => c.campo.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`) === cenario.slice('limpa-'.length),
          )?.campo ?? null)
        : null;
      if (cenario.startsWith('limpa-') && !limpa) throw new Error(`${cenario}: campo não declarado.`);
      // O item já vazio (com a sentinela) ganha antes uma data pelo executor (preparação, antes do retrato).
      let versao = lido.versao;
      if (limpa && (lido.valores[limpa] ?? null) === null) {
        await executarOutra(e, alterar, { codigo, versao, valores: { [limpa]: '2099-12-31' } });
        const relido = await itemDoDominio(e, d, codigo);
        if (!relido) throw new Error(`${d.tabela}: item da preparação não relido.`);
        versao = relido.versao;
      }
      // W0-02 (D-CRUD-30): `texto-longo` grava só os textos longos editáveis, com acentuação CP1252 e acima de 64 KiB.
      const textoLongo =
        cenario === 'texto-longo'
          ? Object.fromEntries(
              (d.textosLongos ?? []).filter((t) => t.editavel).map((t) => [t.campo, textoLongoCp1252()]),
            )
          : null;
      entrada =
        verbo === 'alterar'
          ? {
              codigo,
              versao,
              valores: textoLongo
                ? textoLongo
                : limpa
                  ? { [limpa]: null }
                  : await valoresDeAlteracao(e, d, lido.valores, codigo),
            }
          : { codigo, versao, ...(emUso ? { confirmarEmUso: true } : {}) };
    },
    async executar(e) {
      if (!recusa) {
        await executar(e, entrada);
        return;
      }
      await exigirRecusa(
        executar(e, entrada),
        verbo === 'incluir'
          ? 'duplicado'
          : verbo === 'reativar'
            ? 'ja-ativo'
            : verbo === 'excluir' && cenario === 'recusa-com-dependentes'
              ? 'com-dependentes'
              : 'conflito-versao',
      );
    },
  };
}
