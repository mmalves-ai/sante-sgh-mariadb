// C1-092 (F3.5, 05-SADT linha 14): a remessa ao laboratório de apoio e o de-para chegam ao pessoal do laboratório.
// O perfil complementar próprio `laboratorio-apoio` concede sadt.apoio.ler, sadt.apoio.remessa e
// sadt.apoio.configurar (antes só o administrador do sistema), sem dar a conferência do resultado que volta
// (sadt.apoio.conferir, privativa do responsável técnico com conselho). O cálculo é o mesmo da sessão.
import 'reflect-metadata';
import { PERFIS_COMPLEMENTARES, PERMISSOES_M34 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { calcularAutorizacao } from '../../autorizacao/servico-autorizacao.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { ApoioRemessaController } from './apoio-remessa.controller.js';

const PERFIL = 'laboratorio-apoio';
const VAZIO = {
  unidades: [],
  locais: [],
  convenios: [],
  centrosCusto: [],
  locaisEstoque: [],
  contasBancarias: [],
  tiposAgenda: [],
  tiposProntuario: [],
};

function permissoesDa(
  login: string,
  perfisExtras: readonly string[] = [],
  semOpcoes: readonly number[] = [],
): readonly string[] {
  const conta = CONTAS_SINTETICAS[login];
  if (!conta) throw new Error(`conta ausente: ${login}`);
  const c = conta.concessoes;
  return calcularAutorizacao(
    {
      concessoes: {
        grupo: c?.grupo ?? null,
        opcoesGrupo: (c?.opcoesGrupo ?? []).filter((o) => !semOpcoes.includes(o)),
        opcoesPapel: [],
        papeis: [],
        flags: [],
        conselho: c?.conselho ?? false,
      },
      escopos: VAZIO,
      restricaoVinculo: false,
      perfisConcedidos: [...(conta.perfisConcedidos ?? []), ...perfisExtras].map((perfil) => ({
        perfil,
        inicio: new Date(0),
        fim: null,
      })),
      mapaPerfis: [],
    },
    Date.now(),
  ).permissoes;
}

const proto = ApoioRemessaController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};

describe('laboratório de apoio: permissões do pessoal do laboratório (C1-092)', () => {
  it('o perfil próprio está no catálogo e concede ler, remessa e de-para, nunca a conferência', () => {
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(PERFIL);
    for (const codigo of ['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']) {
      const d = PERMISSOES_M34.find((p) => p.codigo === codigo);
      expect(d).toMatchObject({ concessaoPorPerfil: 'por-perfil' });
      expect(d?.perfis).toContain(PERFIL);
      for (const p of d?.perfis ?? []) expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(p);
    }
    const conferir = PERMISSOES_M34.find((p) => p.codigo === 'sadt.apoio.conferir');
    expect(conferir?.perfis ?? []).not.toContain(PERFIL);
    expect(conferir).toMatchObject({ exigeConselho: true });
  });

  it('as rotas de gravação da remessa e do de-para pedem a permissão própria, com a trilha no handler', () => {
    for (const m of ['abrir', 'agir', 'retirar']) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('sadt.apoio.remessa');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeTruthy();
    }
    expect(meta(CHAVE_PERMISSAO, 'etiquetas')).toBe('sadt.apoio.remessa');
    for (const m of ['deParaAnalito', 'deParaMaterial']) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('sadt.apoio.configurar');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeTruthy();
    }
  });

  it('o técnico do apoio, só com o perfil, lê, monta a remessa e mantém o de-para, sem conferir o resultado', () => {
    expect(CONTAS_SINTETICAS['SINT.LAB.APOIO']?.perfisConcedidos).toEqual([PERFIL]);
    const p = permissoesDa('SINT.LAB.APOIO');
    expect(p).toEqual(
      expect.arrayContaining(['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']),
    );
    expect(p).not.toContain('sadt.apoio.conferir');
    expect(p).not.toContain('sadt.resultado.liberar');
  });

  it('o biomédico migrado lê o apoio pela opção 2964 e, com o perfil concedido, monta a remessa e mantém o de-para', () => {
    // A opção de interfaceamento da origem (2964) dá a leitura pelo mapa do conector; a remessa e o de-para chegam
    // hoje só pela concessão nominal do perfil (a conta sintética não traz o perfil posto à mão).
    expect(CONTAS_SINTETICAS['SINT.BIOMEDICO']?.concessoes?.opcoesGrupo).toContain(2964);
    expect(CONTAS_SINTETICAS['SINT.BIOMEDICO']?.perfisConcedidos ?? []).not.toContain(PERFIL);
    expect(permissoesDa('SINT.BIOMEDICO')).toContain('sadt.apoio.ler');
    const p = permissoesDa('SINT.BIOMEDICO', [PERFIL]);
    expect(p).toEqual(
      expect.arrayContaining(['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']),
    );
  });

  // As linhas 'opcao_menu 2964 sadt.apoio.remessa' e 'opcao_menu 2964 sadt.apoio.configurar' de
  // conector/mapa/permissoes.tsv levam a remessa e o de-para a quem tinha a opção na origem, sem perfil concedido.
  it('o biomédico migrado com a opção 2964, sem perfil concedido, monta a remessa e mantém o de-para', () => {
    const p = permissoesDa('SINT.BIOMEDICO');
    expect(p).toEqual(
      expect.arrayContaining(['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']),
    );
  });

  // Sem o perfil, a remessa e o de-para chegam só pela opção de interfaceamento da origem (2964). A conta sintética
  // do laboratório recebe todas as opções da área S.A.D.T., a 2964 inclusive: sem ela, não monta nem mexe no de-para.
  it('o laboratório sem o perfil e sem a opção 2964 não monta remessa nem mexe no de-para', () => {
    expect(CONTAS_SINTETICAS['SINT.LABORATORIO']?.perfisConcedidos ?? []).not.toContain(PERFIL);
    const p = permissoesDa('SINT.LABORATORIO', [], [2964]);
    expect(p).not.toContain('sadt.apoio.remessa');
    expect(p).not.toContain('sadt.apoio.configurar');
    expect(p).not.toContain('sadt.apoio.ler');
  });

  it('o laboratório com a opção 2964 da origem, sem o perfil, monta a remessa e mantém o de-para', () => {
    expect(CONTAS_SINTETICAS['SINT.LABORATORIO']?.concessoes?.opcoesGrupo).toContain(2964);
    const p = permissoesDa('SINT.LABORATORIO');
    expect(p).toEqual(expect.arrayContaining(['sadt.apoio.remessa', 'sadt.apoio.configurar']));
    expect(p).not.toContain('sadt.apoio.conferir');
  });
});
