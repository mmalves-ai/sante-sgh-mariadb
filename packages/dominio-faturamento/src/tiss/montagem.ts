// Montagem do lote TISS 04.03.00 a partir das contas emitidas (M31; ficha, seção 5, `faturamento.gerarLote`, e regras 1
// e 3): a conta lida do banco (só o que a guia leva) vira a guia do tipo do lote; o cabeçalho leva o registro ANS da
// operadora, o código do prestador na operadora e o CNES; o epílogo, o hash MD5. O XML é validado no XSD oficial antes
// de qualquer gravação, e o erro do validador é explicado em português (a tela mostra o campo e o que fazer).
//   - SP/SADT: procedimentos (TIPO 2 e 3) em procedimentosExecutados; diárias e taxas (TIPO 1) e mat/med (TIPO 4) em
//     outrasDespesas, com o código de despesa pela natureza do item;
//   - resumo de internação: idem, com as datas e o regime da internação;
//   - consulta: o procedimento de consulta (o primeiro item de procedimento);
//   - honorário individual: os honorários (TIPO 2), com o profissional executante.
import {
  type Cabecalho,
  type Despesa,
  type Guia,
  type ItemExecutado,
  type MensagemTiss,
  mensagemLoteGuias,
  mensagemRecursoGlosa,
  type RecursoGlosa,
} from './lote.js';

import type { ContaTiss, DadosPrestador, ItemContaTiss, NaturezaItem } from '@sgh/contratos';

export type { ContaTiss, DadosPrestador, ItemContaTiss, NaturezaItem };

const CODIGO_DESPESA: Readonly<Record<Exclude<NaturezaItem, 'procedimento'>, Despesa['codigoDespesa']>> = {
  gas: '01',
  medicamento: '02',
  material: '03',
  diaria: '05',
  taxa: '07',
  opme: '08',
};

/** Tabela TUSS padrão pela natureza (18 diárias e taxas, 19 materiais e OPME, 20 medicamentos, 22 procedimentos). */
export const TABELA_PADRAO: Readonly<Record<NaturezaItem, string>> = {
  procedimento: '22',
  diaria: '18',
  taxa: '18',
  gas: '18',
  material: '19',
  opme: '19',
  medicamento: '20',
};

/** A natureza do item pelo TIPO (regra 6 do M30); mat/med vem do cadastro do item (material ou medicamento). */
export function naturezaPadrao(tipo: number, medicamento = false): NaturezaItem {
  if (tipo === 1) return 'taxa';
  if (tipo === 4) return medicamento ? 'medicamento' : 'material';
  return 'procedimento';
}

const texto = (s: string, max: number) =>
  s
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'NAO INFORMADO';

function executado(i: ItemContaTiss): ItemExecutado {
  return {
    sequencial: i.sequencial,
    data: i.data,
    procedimento: {
      codigoTabela: i.codigoTabela,
      codigo: i.codigo.slice(0, 10),
      descricao: texto(i.descricao, 150),
    },
    quantidade: Math.max(1, Math.round(i.quantidade)),
    valorUnitario: i.valorUnitario,
  };
}

function despesa(i: ItemContaTiss, seq: number): Despesa {
  const nat = i.natureza === 'procedimento' ? 'taxa' : i.natureza;
  return {
    sequencial: seq,
    codigoDespesa: CODIGO_DESPESA[nat],
    data: i.data,
    codigoTabela: i.codigoTabela,
    codigo: i.codigo.slice(0, 10),
    descricao: texto(i.descricao, 150),
    quantidade: i.quantidade,
    unidadeMedida: '036',
    valorUnitario: i.valorUnitario,
  };
}

const ehProcedimento = (i: ItemContaTiss) => i.natureza === 'procedimento';

/** A guia da conta no tipo do lote (regra 1: só o leiaute 04.03.00). */
export function montarGuia(c: ContaTiss, p: DadosPrestador): Guia {
  const procs = c.itens.filter(ehProcedimento);
  const despesas = c.itens.filter((i) => !ehProcedimento(i)).map((i, k) => despesa(i, k + 1));
  const beneficiario = { numeroCarteira: texto(c.carteira, 20), atendimentoRN: c.atendimentoRN };
  switch (c.tipoGuia) {
    case 1: {
      const proc = procs[0] ?? c.itens[0];
      return {
        tipo: 'consulta',
        numeroGuiaPrestador: c.numeroGuia,
        beneficiario,
        cnes: p.cnes,
        profissional: c.profissional,
        dataAtendimento: c.inicio.data,
        tipoConsulta: c.tipoConsulta,
        procedimento: { codigoTabela: proc?.codigoTabela ?? '22', codigo: (proc?.codigo ?? '').slice(0, 10) },
        valor: c.itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitario * 100), 0) / 100,
      };
    }
    case 2:
      return {
        tipo: 'sp-sadt',
        numeroGuiaPrestador: c.numeroGuia,
        beneficiario,
        nomeContratadoSolicitante: texto(p.nome, 70),
        profissionalSolicitante: c.profissional,
        cnes: p.cnes,
        caraterAtendimento: c.caraterAtendimento,
        tipoAtendimento: c.tipoAtendimento,
        itens: procs.map(executado),
        despesas,
      };
    case 3:
      return {
        tipo: 'resumo-internacao',
        numeroGuiaPrestador: c.numeroGuia,
        numeroGuiaSolicitacao: c.guiaSolicitacao || c.numeroGuia,
        dataAutorizacao: c.dataAutorizacao || c.inicio.data,
        senha: c.senha || c.numeroGuia,
        beneficiario,
        cnes: p.cnes,
        caraterAtendimento: c.caraterAtendimento,
        tipoFaturamento: c.tipoFaturamento,
        inicio: c.inicio,
        fim: c.fim,
        tipoInternacao: c.tipoInternacao,
        regimeInternacao: c.regimeInternacao,
        motivoEncerramento: c.motivoEncerramento,
        itens: procs.map(executado),
        despesas,
      };
    case 4:
      return {
        tipo: 'honorario',
        numeroGuiaPrestador: c.numeroGuia,
        guiaSolicitacaoInternacao: c.guiaSolicitacao || c.numeroGuia,
        beneficiario,
        nomeContratado: texto(p.nome, 70),
        cnes: p.cnes,
        inicio: c.inicio.data,
        fim: c.fim.data,
        caraterAtendimento: c.caraterAtendimento,
        dataEmissao: c.fim.data,
        itens: c.itens
          .filter((i) => i.tipo === 2)
          .map((i) => ({
            ...executado(i),
            equipe: [
              {
                grauParticipacao: '00',
                codigoPrestador: c.profissionalCodigo || p.codigoPrestador,
                nome: texto(c.profissionalNome, 70),
                profissional: c.profissional,
              },
            ],
          })),
      };
  }
}

/** Regra 3: o cabeçalho do lote (registro ANS, código do prestador, sequencial e data e hora da transação). */
export function cabecalhoDoLote(p: DadosPrestador, sequencial: string, agora: Date): Cabecalho {
  const iso = agora.toISOString();
  return {
    sequencialTransacao: String(Number(sequencial) || sequencial),
    data: iso.slice(0, 10),
    hora: iso.slice(11, 19),
    codigoPrestadorNaOperadora: p.codigoPrestador,
    registroANS: p.registroAns,
  };
}

export function montarLote(
  p: DadosPrestador,
  numeroLote: string,
  sequencial: string,
  contas: readonly ContaTiss[],
  agora: Date,
): MensagemTiss {
  return mensagemLoteGuias(
    cabecalhoDoLote(p, sequencial, agora),
    String(Number(numeroLote) || numeroLote),
    contas.map((c) => montarGuia(c, p)),
  );
}

export function montarRecurso(
  p: DadosPrestador,
  sequencial: string,
  r: RecursoGlosa,
  agora: Date,
): MensagemTiss {
  return mensagemRecursoGlosa(cabecalhoDoLote(p, sequencial, agora), r);
}

/** O que falta no cadastro para o cabeçalho (regra 3): o lote não é montado sem eles. */
export function faltasDoPrestador(p: Partial<DadosPrestador>): string[] {
  const f: string[] = [];
  if (!p.registroAns || !/^\d{6}$/.test(p.registroAns)) f.push('registro ANS da operadora (6 dígitos)');
  if (!p.codigoPrestador) f.push('código do prestador na operadora');
  if (!p.cnes) f.push('CNES do estabelecimento');
  return f;
}

/** Explica em português o erro do validador do XSD (libxml2): o campo e o que fazer. */
export function explicarErroXsd(erro: string): string {
  const campo = (s: string) => /\}([A-Za-z-]+)'?/.exec(s)?.[1] ?? null;
  const elemento = campo(erro);
  const esperado = /Expected is \(? ?\{[^}]*\}([A-Za-z-]+)/.exec(erro)?.[1] ?? null;
  if (/This element is not expected/.test(erro) && esperado)
    return `Falta o campo "${esperado}" antes de "${elemento ?? '?'}" (campo obrigatório da TISS 04.03.00).`;
  if (/Missing child element/.test(erro))
    return `Falta o campo "${esperado ?? '?'}" dentro de "${elemento ?? '?'}" (obrigatório na TISS 04.03.00).`;
  if (/facet 'pattern'|facet 'length'|facet 'maxLength'|facet 'minLength'/.test(erro))
    return `O campo "${elemento ?? '?'}" está fora do formato exigido (tamanho ou padrão). Corrija o cadastro de origem.`;
  if (/facet 'enumeration'/.test(erro))
    return `O campo "${elemento ?? '?'}" tem um código que não existe na tabela da TISS 04.03.00.`;
  if (/is not a valid value/.test(erro))
    return `O campo "${elemento ?? '?'}" tem valor inválido para o tipo da TISS 04.03.00.`;
  if (/hash do epílogo/.test(erro))
    return 'O hash do epílogo não confere: o XML foi alterado depois de montado.';
  if (/Padrao|versão/.test(erro)) return erro;
  return `O validador recusou: ${erro.slice(0, 200)}`;
}
