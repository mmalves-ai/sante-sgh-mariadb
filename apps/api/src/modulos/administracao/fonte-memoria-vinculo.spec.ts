// 01-ADM L59 (C2-051): vínculo da conta ao estabelecimento na memória (fonte sintética do E2E), com as regras do
// domínio: encerrar fecha (vínculo antigo) ou anula (começou hoje); dar acesso só a quem não tem; o único vínculo
// e o próprio não se encerram.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { estadoAcessoSintetico } from '../acesso/fonte-sintetica.js';
import { fonteAdministracaoMemoria } from './fonte-memoria.js';
import type { ContextoGestao } from './tipos.js';

const ctx: ContextoGestao = {
  rede: 'SINT',
  hospital: 'SINT',
  correlacao: 'c',
  login: 'SINT.GESTOR',
  usuario: null,
  chaveIdempotencia: 'k',
  estacao: 'e',
};
const codigo = async (p: Promise<unknown>) =>
  p.then(() => 'ok').catch((e: { problema?: { codigo?: string } }) => e.problema?.codigo);

describe('vínculo ao estabelecimento na memória (01-ADM L59)', () => {
  it('encerra, dá acesso de novo e anula o que começou hoje; recusas do domínio', async () => {
    const f = fonteAdministracaoMemoria(new RegistradorTrilhaMemoria(), null, 'dev');
    const grupo = [...estadoAcessoSintetico().grupos].find(([, ativo]) => ativo)![0];
    const vinc = (login: string, g = grupo) =>
      f.executar('acesso.vincularEstabelecimentoUsuario', { login, grupo: g }, ctx);
    const enc = (login: string, c = ctx) => f.executar('acesso.encerrarVinculoUsuario', { login }, c);
    expect(await codigo(enc('SINT.MEDICO'))).toBe('unico-vinculo');
    expect(await codigo(enc('SINT.GESTOR'))).toBe('proprio-vinculo');
    expect(await codigo(enc('SINT.NAO-EXISTE'))).toBe('usuario-inexistente');
    expect(await codigo(vinc('SINT.MULTIUNIDADE'))).toBe('ja-vinculado');
    expect(await enc('SINT.MULTIUNIDADE')).toMatchObject({ modo: 'fechar' });
    expect(await codigo(enc('SINT.MULTIUNIDADE'))).toBe('nao-vinculado');
    expect(await codigo(vinc('SINT.MULTIUNIDADE', 'GRUPO-QUE-NAO-EXISTE'))).toBe('grupo-inexistente');
    expect(await vinc('SINT.MULTIUNIDADE')).toMatchObject({ modo: 'vinculado' });
    expect(await enc('SINT.MULTIUNIDADE')).toMatchObject({ modo: 'anular' });
    expect(await vinc('SINT.MULTIUNIDADE')).toMatchObject({ modo: 'vinculado' });
  });
});
