// Unidade da família "pep-resto" das gravações próprias dos documentos: normalização da descrição livre, origem da
// informação, esquemas próprios (agente OU descrição livre; dias de afastamento do atestado) e as recusas que acontecem
// antes de qualquer acesso ao banco (o núcleo falso falha se for tocado).
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';
import {
  descricaoNormalizada,
  esquemaAlergiaPropria,
  esquemaEmissaoPropria,
  fonteDaOrigem,
  OPERACOES_PEP_RESTO,
  operacoesDocumentosPropria,
} from './documentos-propria-operacoes.js';

const HASH = 'a'.repeat(64);
const DOC = 'x'.repeat(60);
const nucleoIntocavel = {
  lerSomente: () => Promise.reject(new Error('o banco não podia ser tocado')),
  criarExecutor: () => ({ executar: () => Promise.reject(new Error('o executor não podia ser tocado')) }),
} as unknown as NucleoDocumentosPep;
const C = { rede: 'r', hospital: 'h', cliente: 'c', estabelecimento: null, usuario: 1, correlacao: 't' };
const CTX = { cliente: 'c', estabelecimento: 1, usuario: 1, correlacao: 't', chaveIdempotencia: 'k' };
const ops = operacoesDocumentosPropria(nucleoIntocavel, 'c');

const alergia = {
  paciente: 1,
  atendimento: 2,
  cbo: 3,
  registro: 4,
  nega: false,
  principios: [],
  versao: '',
  hashConteudo: HASH,
};
const atestado = {
  familia: 'atestado',
  paciente: 1,
  atendimento: 2,
  cbo: 3,
  retratos: { htAtendimento: 2, htPaciente: 1 },
  dataHoraClinica: '2026-11-24T10:00',
  documento: DOC,
  hashConteudo: HASH,
  tipo: 'atestado',
  modeloNome: 'Atestado médico',
  conteudoXml: '<atestado>sintetico</atestado>',
};

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem-erro';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
}

describe('documentos-propria-operacoes (unidade)', () => {
  it('cobre as cinco operações e só elas', () => {
    expect(Object.keys(ops).sort()).toEqual([...OPERACOES_PEP_RESTO].sort());
  });

  it('descrição livre normalizada: sem acento, sem caixa, espaços colapsados', () => {
    expect(descricaoNormalizada('  Dipirona   SÓDICA ')).toBe('dipirona sodica');
    expect(descricaoNormalizada('Látex')).toBe(descricaoNormalizada('latex'));
  });

  it('origem da informação vai ao valor do banco', () => {
    expect(fonteDaOrigem('relato-paciente')).toBe('relato_paciente');
    expect(fonteDaOrigem(undefined)).toBeNull();
  });

  it('alergia: agente OU descrição livre; nega dispensa os dois', () => {
    expect(esquemaAlergiaPropria.safeParse(alergia).success).toBe(false);
    expect(esquemaAlergiaPropria.safeParse({ ...alergia, agente: 9 }).success).toBe(true);
    expect(esquemaAlergiaPropria.safeParse({ ...alergia, descricaoLivre: 'Dipirona' }).success).toBe(true);
    expect(esquemaAlergiaPropria.safeParse({ ...alergia, nega: true }).success).toBe(true);
    expect(esquemaAlergiaPropria.safeParse({ ...alergia, agente: 9, extra: 1 }).success).toBe(false);
  });

  it('emissão: o atestado aceita os dias de afastamento; a receita não', () => {
    expect(esquemaEmissaoPropria.safeParse({ ...atestado, diasAfastamento: 2 }).success).toBe(true);
    expect(esquemaEmissaoPropria.safeParse({ ...atestado, diasAfastamento: 400 }).success).toBe(false);
  });

  it('recusas antes do banco: entrada inválida, CID sem autorização, atestado sem dias, exame no futuro', async () => {
    expect(await codigo(ops['pep.registrarAlergia']!(C, alergia, CTX))).toBe('entrada-invalida');
    expect(await codigo(ops['pep.inativarAlergia']!(C, { paciente: 1 }, CTX))).toBe('entrada-invalida');
    expect(await codigo(ops['pep.emitirDocumento']!(C, { ...atestado, cid: 'A09' }, CTX))).toBe(
      'cid-sem-autorizacao',
    );
    expect(await codigo(ops['pep.emitirDocumento']!(C, atestado, CTX))).toBe('dias-afastamento-obrigatorio');
    expect(
      await codigo(
        ops['pep.lancarExameExterno']!(
          C,
          {
            paciente: 1,
            atendimento: 2,
            cbo: 3,
            retratos: { htAtendimento: 2, htPaciente: 1 },
            dataHoraClinica: '2026-11-24T10:00',
            realizadoEm: '2026-11-24T11:00',
            nomeExame: 'Hemograma',
            rtf: '{\\rtf1 sintetico}',
            itens: [],
            documento: DOC,
            hashConteudo: HASH,
          },
          CTX,
        ),
      ),
    ).toBe('horario-futuro');
    expect(await codigo(ops['pep.finalizarSumarioAlta']!(C, { paciente: 1 }, CTX))).toBe('entrada-invalida');
  });
});
