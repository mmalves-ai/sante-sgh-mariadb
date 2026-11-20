// M06 (revisão): o registrador da trilha dupla com dublês do núcleo e do executor. Login que nem é um
// TBUSERS.NOME válido (mais de 31 caracteres, espaço no início) e recusa de usuário pelo executor vão só à
// SGH_TRILHA como "(desconhecido)": o texto digitado nunca vai à trilha. Dados sintéticos.
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { ErroOperacao, type LinhaTrilha } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { type EventoParaTrilha, RegistradorTrilhaLegado, USUARIO_DESCONHECIDO } from './trilha.js';

function montar(recusa: string | null) {
  const proprias: LinhaTrilha[] = [];
  let executadas = 0;
  const nucleo = {
    registrarTrilhaPropria: (_: unknown, l: LinhaTrilha) => {
      proprias.push(l);
      return Promise.resolve({ id: String(proprias.length) });
    },
  };
  const executor = {
    executar: () => {
      executadas++;
      if (recusa) return Promise.reject(new ErroOperacao(400, recusa, 'x', 'x'));
      return Promise.resolve({ resultado: { idTrilha: 7 }, trilha: '3', repetida: false, eventos: [] });
    },
  } as unknown as ConstructorParameters<typeof RegistradorTrilhaLegado>[1];
  return { r: new RegistradorTrilhaLegado(nucleo, executor), proprias, executadas: () => executadas };
}

const base: EventoParaTrilha = {
  evento: EVENTOS_AUDITAVEIS.loginFalho.codigo,
  rede: 'rede-teste',
  hospital: 'pc',
  usuario: 'SINT.USUARIO',
  estacao: 'SGH-WEB:127.0.0.1',
  correlacao: 'sessao',
  recurso: 'sessao',
  resultado: 'falha',
};

describe('trilha dupla: usuário que o legado não conhece (revisão do M06)', () => {
  it('login com mais de 31 caracteres ou espaço no início: só SGH_TRILHA, como (desconhecido)', async () => {
    for (const usuario of ['X'.repeat(40), ' SINT.USUARIO']) {
      const m = montar(null);
      await expect(m.r.registrar({ ...base, usuario })).resolves.toEqual({ sgh: '1', legado: null });
      expect(m.executadas()).toBe(0);
      expect(m.proprias.map((l) => l.usuario)).toEqual([USUARIO_DESCONHECIDO]);
    }
  });

  it('recusa de usuário ou de contexto pelo executor: só SGH_TRILHA; outro erro sobe', async () => {
    for (const codigo of ['usuario-inexistente', 'contexto-invalido']) {
      const m = montar(codigo);
      await expect(m.r.registrar(base)).resolves.toEqual({ sgh: '1', legado: null });
      expect(m.proprias.map((l) => l.usuario)).toEqual([USUARIO_DESCONHECIDO]);
    }
    await expect(montar('trilha-indisponivel').r.registrar(base)).rejects.toBeInstanceOf(ErroOperacao);
  });

  it('gravação na trilha do outro sistema não liberada ou bloqueada (M60.3): só SGH_TRILHA, com o usuário real', async () => {
    for (const codigo of ['operacao-nao-liberada', 'operacao-bloqueada']) {
      const m = montar(codigo);
      await expect(m.r.registrar(base)).resolves.toEqual({ sgh: '1', legado: null });
      expect(m.executadas()).toBe(1);
      expect(m.proprias.map((l) => l.usuario)).toEqual(['SINT.USUARIO']);
    }
  });

  it('usuário conhecido: trilha do legado e SGH_TRILHA pelo executor', async () => {
    const m = montar(null);
    await expect(m.r.registrar(base)).resolves.toEqual({ sgh: '3', legado: '7' });
    expect(m.proprias).toEqual([]);
  });
});

describe('trilha dupla: login de outro banco sem a prova de que é a mesma pessoa (correção do M57.2)', () => {
  it('usuarioNaoConfirmado: nada vai ao executor; só SGH_TRILHA, como (desconhecido), com a chave natural', async () => {
    const m = montar(null);
    const e: EventoParaTrilha = {
      ...base,
      evento: EVENTOS_AUDITAVEIS.prontuarioRedeLido.codigo,
      hospital: 'sx',
      resultado: 'sucesso',
      recurso: 'pep.prontuario',
      paciente: 101,
      chaveNaturalAlvo: 'rede;de:pc;por:SINT.USUARIO;motivo:assistencia;parte:linha-do-tempo',
      usuarioNaoConfirmado: true,
    };
    await expect(m.r.registrar(e)).resolves.toEqual({ sgh: '1', legado: null });
    expect(m.executadas()).toBe(0);
    expect(m.proprias).toHaveLength(1);
    expect(m.proprias[0]).toMatchObject({
      usuario: USUARIO_DESCONHECIDO,
      hospital: 'sx',
      chaveNaturalAlvo: 'rede;de:pc;por:SINT.USUARIO;motivo:assistencia;parte:linha-do-tempo',
    });
  });
});
