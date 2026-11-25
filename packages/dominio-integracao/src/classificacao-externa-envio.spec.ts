import { describe, expect, it } from 'vitest';
import {
  conferirCredencialTriagem,
  conferirEnvioPerfis,
  decidirEnvioPerfis,
  type CredencialTriagem,
  ESCOPO_ENTRADA_TRIAGEM,
  montarPerfisHl7,
} from './classificacao-externa-envio.js';

const perfilMsg = { versaoHl7: '2.5.1', separadorCampo: '|', caracteresCodificacao: '^~\\&', ativo: true };
const perfis = [
  { codigo: 'G', descricao: 'Gestante', condicao: 'gestante', ordem: 2 },
  { codigo: 'I', descricao: 'Idoso | 60+', condicao: 'idoso', ordem: 1 },
];

describe('envio ativo dos perfis ao sistema de triagem', () => {
  it('confere sistema, parceiro HL7, perfil de mensagem e perfis', () => {
    expect(
      conferirEnvioPerfis({
        sistemaTriagemAtivo: true,
        parceiroHl7ComCanal: true,
        perfilMensagem: perfilMsg,
        perfis,
      }),
    ).toEqual([]);
    const tudo = conferirEnvioPerfis({
      sistemaTriagemAtivo: false,
      parceiroHl7ComCanal: false,
      perfilMensagem: null,
      perfis: [],
    }).map((e) => e.codigo);
    expect(tudo).toEqual(['sistema-nao-triagem', 'sem-parceiro-hl7', 'sem-perfil-mensagem', 'sem-perfis']);
    expect(
      conferirEnvioPerfis({
        sistemaTriagemAtivo: true,
        parceiroHl7ComCanal: true,
        perfilMensagem: { ...perfilMsg, separadorCampo: '#' },
        perfis,
      }).map((e) => e.codigo),
    ).toEqual(['separadores-nao-suportados']);
    expect(
      conferirEnvioPerfis({
        sistemaTriagemAtivo: true,
        parceiroHl7ComCanal: true,
        perfilMensagem: { ...perfilMsg, ativo: false },
        perfis,
      }).map((e) => e.codigo),
    ).toEqual(['sem-perfil-mensagem']);
  });

  it('monta a MFN^M13 na versão do perfil, com um MFE por perfil na ordem e o texto escapado', () => {
    const m = montarPerfisHl7(
      {
        aplicacaoOrigem: 'SGH',
        instituicaoOrigem: 'H1',
        aplicacaoDestino: 'TRI',
        dataHora: new Date(Date.UTC(2026, 10, 25, 9, 30, 0)),
        controle: 'PRF1a2b3c',
        processamento: 'T',
      },
      perfilMsg,
      perfis,
    ).split('\r');
    expect(m[0]).toBe('MSH|^~\\&|SGH|H1|TRI|TRI|20261125093000||MFN^M13^MFN_M13|PRF1a2b3c|T|2.5.1');
    expect(m[1]).toBe('MFI|PRIORIDADE^Perfis de prioridade^L||REP|20261125093000|20261125093000|AL');
    expect(m[2]).toBe('MFE|MAD|1|20261125093000|I^Idoso \\F\\ 60+^L^idoso^^L|CWE');
    expect(m[3]).toBe('MFE|MAD|2|20261125093000|G^Gestante^L^gestante^^L|CWE');
    expect(m).toHaveLength(4);
    const v24 = montarPerfisHl7(
      {
        aplicacaoOrigem: 'SGH',
        instituicaoOrigem: 'H1',
        aplicacaoDestino: 'TRI',
        dataHora: new Date(0),
        controle: 'X1',
        processamento: 'P',
      },
      { ...perfilMsg, versaoHl7: '2.4' },
      [{ codigo: 'O', descricao: 'Outro', condicao: null, ordem: 0 }],
    ).split('\r');
    expect(v24[0]!.endsWith('|X1|P|2.4')).toBe(true);
    expect(v24[2]).toBe('MFE|MAD|1|19700101000000|O^Outro^L|CE');
    expect(() =>
      montarPerfisHl7(
        {
          aplicacaoOrigem: 'S',
          instituicaoOrigem: 'H',
          aplicacaoDestino: 'T',
          dataHora: new Date(0),
          controle: 'com espaço',
          processamento: 'T',
        },
        perfilMsg,
        perfis,
      ),
    ).toThrow();
  });
});

describe('entrada pela credencial do sistema de triagem', () => {
  const ok: CredencialTriagem = {
    categoriaSistema: 'triagem',
    sistemaAtivo: true,
    situacaoCliente: 'ativo',
    restritoA: null,
    estabelecimento: 7,
    usuarioTecnico: 3,
    escopos: [ESCOPO_ENTRADA_TRIAGEM],
  };
  it('vale só para o sistema de triagem ativo, no estabelecimento, com usuário técnico e escopo', () => {
    expect(conferirCredencialTriagem(ok)).toEqual([]);
    expect(conferirCredencialTriagem({ ...ok, restritoA: 7 })).toEqual([]);
    const cod = (x: Partial<CredencialTriagem>) =>
      conferirCredencialTriagem({ ...ok, ...x }).map((e) => e.codigo);
    expect(cod({ categoriaSistema: 'laboratorio' })).toEqual(['nao-e-triagem']);
    expect(cod({ categoriaSistema: null })).toEqual(['nao-e-triagem']);
    expect(cod({ sistemaAtivo: false })).toEqual(['nao-e-triagem']);
    expect(cod({ situacaoCliente: 'suspenso' })).toEqual(['credencial-inativa']);
    expect(cod({ restritoA: 8 })).toEqual(['outro-estabelecimento']);
    expect(cod({ usuarioTecnico: null })).toEqual(['sem-usuario-tecnico']);
    expect(cod({ escopos: ['resultado.enviar'] })).toEqual(['fora-do-escopo']);
  });
});

describe('reenvio do mesmo pacote de perfis no mesmo dia', () => {
  const base = 'perfis:tri:abc:2026-11-25';
  it('sem mensagem: nova com a chave base; viva (na fila, a caminho ou entregue): repetida', () => {
    expect(decidirEnvioPerfis(base, [])).toEqual({ acao: 'nova', chave: base, sufixoControle: '' });
    for (const situacao of ['pendente', 'enviando', 'enviada', 'confirmada'])
      expect(decidirEnvioPerfis(base, [{ chave: base, situacao }])).toEqual({
        acao: 'repetida',
        chave: base,
      });
  });
  it('morta (erro, rejeitada, expirada): recusada, apontando o reprocessamento; nada novo entra', () => {
    for (const situacao of ['erro', 'rejeitada', 'expirada']) {
      const d = decidirEnvioPerfis(base, [{ chave: base, situacao }]);
      expect(d.acao).toBe('recusar');
      if (d.acao === 'recusar') {
        expect(d.erro.codigo).toBe('envio-anterior-falhou');
        expect(d.erro.mensagem).toContain('fila de mortos');
      }
    }
    expect(decidirEnvioPerfis(base, [{ chave: base, situacao: 'estranha' }]).acao).toBe('recusar');
  });
  it('cancelada (morta descartada): nova com a chave e o MSH-10 seguintes; a reenviada viva fica repetida', () => {
    const c1 = [{ chave: base, situacao: 'cancelada' }];
    expect(decidirEnvioPerfis(base, c1)).toEqual({ acao: 'nova', chave: `${base}:r1`, sufixoControle: 'R1' });
    const c2 = [...c1, { chave: `${base}:r1`, situacao: 'cancelada' }];
    expect(decidirEnvioPerfis(base, c2)).toMatchObject({ chave: `${base}:r2`, sufixoControle: 'R2' });
    expect(decidirEnvioPerfis(base, [...c1, { chave: `${base}:r1`, situacao: 'pendente' }])).toEqual({
      acao: 'repetida',
      chave: `${base}:r1`,
    });
    // Outra chave que só começa igual (outro pacote) não conta.
    expect(decidirEnvioPerfis(base, [{ chave: `${base}x`, situacao: 'pendente' }]).acao).toBe('nova');
  });
});
