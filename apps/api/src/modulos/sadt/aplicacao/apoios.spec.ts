// F3.5 (decisão "tudo ligado"): o SADT não tem chave de liberação por setor; vale só a permissão do cargo. Sem nenhuma
// configuração de funcionalidades, quem tem a permissão grava; quem não tem recebe o motivo do perfil.
import { describe, expect, it } from 'vitest';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { PortaSadt } from '../porta.js';
import { ApoiosSadt } from './apoios.js';

const porta = {
  destino: 'banco',
  podeGravar: async (_c: unknown, op: string) =>
    op === 'sadt.emitirLaudo'
      ? { pode: true, codigo: null, motivo: null }
      : { pode: false, codigo: 'operacao-nao-liberada', motivo: 'aguarda o contrato novo' },
  vinculos: async () => [],
} as unknown as PortaSadt;

const sessao = (permissoes: readonly string[]) =>
  ({
    rede: 'r',
    hospital: 'h',
    login: 'SINT.TESTE',
    porta: {},
    req: {},
    pode: (p: string) => permissoes.includes(p),
  }) as unknown as SessaoCadastro;

describe('ApoiosSadt: tudo ligado, só a permissão do cargo (F3.5)', () => {
  const apoios = new ApoiosSadt(porta, {} as RegistradorTrilha, null, null);

  it('todos os setores e funcionalidades ficam ligados sem chave nem configuração', async () => {
    const g = await apoios.gravacao(sessao(['sadt.laudo.imprimir']));
    for (const x of Object.values(g.setores)) expect(x).toEqual({ ligada: true, motivo: null });
    for (const x of [g.rastreio, g.critico, g.portal, g.orcamento, g.requisicao])
      expect(x).toEqual({ ligada: true, motivo: null });
    await expect(apoios.setores.imagem.exigirLiberacao(sessao([]))).resolves.toBeUndefined();
  });

  it('a operação depende da permissão do cargo; a emissão do laudo grava; as pendentes mostram o motivo', async () => {
    const com = await apoios.gravacao(sessao(['sadt.laudo.imprimir', 'sadt.resultado.liberar']));
    expect(com.operacoes['laboratorio:sadt.emitirLaudo']).toEqual({ ligada: true, motivo: null });
    expect(com.operacoes['laboratorio:sadt.liberarExame']).toEqual({
      ligada: false,
      motivo: 'aguarda o contrato novo',
    });
    const sem = await apoios.gravacao(sessao([]));
    expect(sem.operacoes['laboratorio:sadt.emitirLaudo']).toEqual({
      ligada: false,
      motivo: 'Seu perfil não permite esta ação.',
    });
  });
});
