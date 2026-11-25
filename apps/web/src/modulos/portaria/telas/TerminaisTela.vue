<script setup lang="ts">
// Terminais e catracas (M50, etapa 5; item `Hotelaria e apoio > Portaria e visitantes > Terminais e catracas`;
// `hotelaria.terminal.ler` / `.editar`): os terminais da portaria (o tipo e o fabricante do domínio do estabelecimento,
// o local e o sentido), pela versão lida; os eventos recentes da catraca (liberado ou negado, com o motivo); a
// integração (chave `portaria.catraca`, autorização do dono em produção) e, fora de produção, o simulador; os tipos e
// fabricantes de terminal pelo CRUD genérico (só consulta: o banco os trata como dado de sistema).
import type { RegraAcessoTerminalLida, SentidoCatraca, SentidoTerminal, TerminalLido } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import {
  gravarRegraAcesso,
  gravarTerminal,
  lerTerminais,
  simularCatraca,
  vincularCrachaColaborador,
} from '../api-portaria.js';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t, te } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['portaria', 'terminais'], queryFn: () => lerTerminais() });
const p = computed(() => painel.data.value);
const pode = computed(() => p.value?.gravacao.operacoes['terminal']?.pode === true);
const erro = ref<unknown>(null);
const mensagem = ref('');
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const recarregar = () => cliente.invalidateQueries({ queryKey: ['portaria', 'terminais'] });

const editando = ref<TerminalLido | null>(null);
const form = ref({
  nome: '',
  tipoTerminal: null as number | null,
  local: '',
  sentido: 'ambos' as SentidoTerminal,
  ativo: true,
});
function editar(x: TerminalLido | null): void {
  editando.value = x;
  form.value = x
    ? { nome: x.nome, tipoTerminal: x.tipoTerminal, local: x.local, sentido: x.sentido, ativo: x.ativo }
    : { nome: '', tipoTerminal: null, local: '', sentido: 'ambos', ativo: true };
}
const opcoesTipo = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.dominios.tiposTerminal ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.codigo as number | null, rotulo: `${x.nome} · ${x.fabricanteNome}` })),
]);
const opcoesSentido = computed(() =>
  (['entrada', 'saida', 'ambos'] as const).map((s) => ({
    valor: s,
    rotulo: t(`portaria.terminais.sentidos.${s}`),
  })),
);
async function gravar(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (
      await gravarTerminal(editando.value?.id ?? null, {
        ...form.value,
        versao: editando.value?.versao ?? null,
      })
    ).mensagem;
    editar(null);
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}

const sim = ref({ terminal: null as number | null, cracha: '', sentido: 'entrada' as SentidoCatraca });
const opcoesTerminal = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.terminais ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const opcoesSentidoCatraca = computed(() =>
  (['entrada', 'saida'] as const).map((s) => ({ valor: s, rotulo: t(`portaria.terminais.sentidos.${s}`) })),
);
const resultado = ref<string | null>(null);
async function simular(): Promise<void> {
  erro.value = null;
  try {
    const r = await simularCatraca({
      terminal: sim.value.terminal,
      cracha: sim.value.cracha.trim().toUpperCase(),
      sentido: sim.value.sentido,
    });
    resultado.value =
      r.resultado === 'liberado'
        ? t('portaria.terminais.liberado')
        : t('portaria.terminais.negado', { motivo: textoMotivo(r.motivo) });
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}

/** O motivo da recusa pelo código do domínio (o texto livre de recusas antigas aparece como veio). */
function textoMotivo(m: string | null): string {
  if (m === null) return '';
  const k = `portaria.terminais.motivos.${m}`;
  return te(k) ? t(k) : m;
}

// Regras de acesso do colaborador por terminal (perfil, setor, dias, faixa, sentido e vigência; pela versão; a
// desativação é por `ativo`, nunca exclusão). A validação roda na hora, antes de gravar.
const DIAS = [1, 2, 3, 4, 5, 6, 7] as const;
const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const regraEditando = ref<RegraAcessoTerminalLida | null>(null);
const regraVazia = () => ({
  terminal: null as number | null,
  perfil: null as number | null,
  setor: null as number | null,
  diasSemana: [2, 3, 4, 5, 6] as number[],
  horaInicio: '00:00',
  horaFim: '23:59',
  entrada: true,
  saida: true,
  vigenciaInicio: hojeIso(),
  vigenciaFim: '' as string,
  prioridade: 0,
  ativo: true,
});
const regra = ref(regraVazia());
function editarRegra(x: RegraAcessoTerminalLida | null): void {
  regraEditando.value = x;
  regra.value = x
    ? {
        terminal: x.terminal,
        perfil: x.perfil,
        setor: x.setor,
        diasSemana: [...x.diasSemana],
        horaInicio: x.horaInicio.slice(0, 5),
        horaFim: x.horaFim.slice(0, 5),
        entrada: x.entrada,
        saida: x.saida,
        vigenciaInicio: x.vigenciaInicio,
        vigenciaFim: x.vigenciaFim ?? '',
        prioridade: x.prioridade,
        ativo: x.ativo,
      }
    : regraVazia();
}
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const problemasRegra = computed(() => {
  const r = regra.value;
  const lista: string[] = [];
  if (r.diasSemana.length === 0) lista.push(t('portaria.terminais.regrasAcesso.semDia'));
  if (!r.entrada && !r.saida) lista.push(t('portaria.terminais.regrasAcesso.semSentido'));
  if (!HORA.test(r.horaInicio) || !HORA.test(r.horaFim))
    lista.push(t('portaria.terminais.regrasAcesso.horaInvalida'));
  if (r.vigenciaFim !== '' && r.vigenciaFim < r.vigenciaInicio)
    lista.push(t('portaria.terminais.regrasAcesso.vigenciaInvalida'));
  return lista;
});
const opcoesPerfil = computed(() => [
  { valor: null, rotulo: t('portaria.terminais.regrasAcesso.qualquer') },
  ...(p.value?.perfisAcesso ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const opcoesSetor = computed(() => [
  { valor: null, rotulo: t('portaria.terminais.regrasAcesso.qualquer') },
  ...(p.value?.setores ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const nomePerfil = (id: number | null) =>
  id === null
    ? t('portaria.terminais.regrasAcesso.qualquer')
    : (p.value?.perfisAcesso.find((x) => x.id === id)?.nome ?? String(id));
const nomeSetor = (id: number | null) =>
  id === null
    ? t('portaria.terminais.regrasAcesso.qualquer')
    : (p.value?.setores.find((x) => x.id === id)?.nome ?? String(id));
const nomeTerminal = (id: number) => p.value?.terminais.find((x) => x.id === id)?.nome ?? String(id);
const diasTexto = (d: readonly number[]) =>
  [...d]
    .sort((a, b) => a - b)
    .map((x) => t(`portaria.terminais.regrasAcesso.diasCurtos.${x}`))
    .join(', ');
function corpoRegra(r: ReturnType<typeof regraVazia>, versao: number | null) {
  return {
    perfil: r.perfil,
    setor: r.setor,
    diasSemana: [...r.diasSemana].sort((a, b) => a - b),
    horaInicio: r.horaInicio,
    horaFim: r.horaFim,
    entrada: r.entrada,
    saida: r.saida,
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: r.vigenciaFim === '' ? null : r.vigenciaFim,
    prioridade: r.prioridade,
    ativo: r.ativo,
    versao,
  };
}
async function gravarRegra(): Promise<void> {
  const r = regra.value;
  if (r.terminal === null || problemasRegra.value.length > 0) return;
  erro.value = null;
  try {
    mensagem.value = (
      await gravarRegraAcesso(
        r.terminal,
        regraEditando.value?.id ?? null,
        corpoRegra(r, regraEditando.value?.versao ?? null),
      )
    ).mensagem;
    editarRegra(null);
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}
async function alternarRegra(x: RegraAcessoTerminalLida): Promise<void> {
  erro.value = null;
  try {
    const base = {
      terminal: x.terminal,
      perfil: x.perfil,
      setor: x.setor,
      diasSemana: [...x.diasSemana],
      horaInicio: x.horaInicio.slice(0, 5),
      horaFim: x.horaFim.slice(0, 5),
      entrada: x.entrada,
      saida: x.saida,
      vigenciaInicio: x.vigenciaInicio,
      vigenciaFim: x.vigenciaFim ?? '',
      prioridade: x.prioridade,
      ativo: !x.ativo,
    };
    mensagem.value = (await gravarRegraAcesso(x.terminal, x.id, corpoRegra(base, x.versao))).mensagem;
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}

// Crachá do colaborador ligado à matrícula (o código que a catraca lê).
const crachaCol = ref({ matricula: '', codigo: '' });
const CODIGO_CRACHA = /^[A-Z0-9]{6,20}$/;
const codigoCrachaOk = computed(() => CODIGO_CRACHA.test(crachaCol.value.codigo.trim().toUpperCase()));
async function ligarCracha(retirar: boolean): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (
      await vincularCrachaColaborador({
        matricula: crachaCol.value.matricula.trim(),
        cracha: retirar ? null : crachaCol.value.codigo.trim().toUpperCase(),
      })
    ).mensagem;
    crachaCol.value = { matricula: '', codigo: '' };
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="tm-titulo" data-testid="tela-terminais">
    <h1 id="tm-titulo">{{ t('portaria.terminais.titulo') }}</h1>
    <p>{{ t('portaria.terminais.subtitulo') }}</p>
    <p v-if="painel.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="painel.error.value" :erro="painel.error.value" />
    <template v-else-if="p">
      <SanteAlerta
        :variante="p.catracaLigada ? 'info' : 'aviso'"
        :texto="
          p.catracaLigada ? t('portaria.terminais.catracaLigada') : t('portaria.terminais.catracaDesligada')
        "
        data-testid="tm-catraca"
      />
      <p v-if="mensagem" role="status" data-testid="tm-mensagem">{{ mensagem }}</p>
      <ErroPortaria v-if="erro" :erro="erro" />

      <section class="cartao" aria-labelledby="tm-lista">
        <h2 id="tm-lista">{{ t('portaria.terminais.lista') }}</h2>
        <p v-if="p.terminais.length === 0">{{ t('portaria.terminais.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="tm-terminais">
            <thead>
              <tr>
                <th scope="col">{{ t('portaria.terminais.nome') }}</th>
                <th scope="col">{{ t('portaria.terminais.tipo') }}</th>
                <th scope="col">{{ t('portaria.terminais.local') }}</th>
                <th scope="col">{{ t('portaria.terminais.sentido') }}</th>
                <th scope="col">{{ t('portaria.terminais.ativo') }}</th>
                <th scope="col">{{ t('portaria.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in p.terminais" :key="x.id">
                <td>{{ x.nome }}</td>
                <td>{{ x.tipoNome }} · {{ x.fabricanteNome }}</td>
                <td>{{ x.local }}</td>
                <td>{{ t(`portaria.terminais.sentidos.${x.sentido}`) }}</td>
                <td>{{ x.ativo ? t('portaria.sim') : t('portaria.nao') }}</td>
                <td>
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portaria.regras.editar')"
                    :desabilitado="!pode"
                    @acionar="editar(x)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form class="registro" data-testid="tm-form" @submit.prevent="gravar">
          <h3>
            {{
              editando
                ? t('portaria.terminais.alterar', { nome: editando.nome })
                : t('portaria.terminais.novo')
            }}
          </h3>
          <div class="campos">
            <span class="campo">
              <label for="tm-nome">{{ t('portaria.terminais.nome') }}</label>
              <input id="tm-nome" v-model="form.nome" maxlength="40" data-testid="tm-nome" />
            </span>
            <SanteSelecao
              v-model="form.tipoTerminal"
              :rotulo="t('portaria.terminais.tipo')"
              :opcoes="opcoesTipo"
              data-testid="tm-tipo"
            />
            <span class="campo">
              <label for="tm-local">{{ t('portaria.terminais.local') }}</label>
              <input id="tm-local" v-model="form.local" maxlength="40" data-testid="tm-local" />
            </span>
            <label class="barra"
              ><input v-model="form.ativo" type="checkbox" /> {{ t('portaria.terminais.ativo') }}</label
            >
          </div>
          <SanteOpcoes
            v-model="form.sentido"
            :legenda="t('portaria.terminais.sentido')"
            :opcoes="opcoesSentido"
            nome="tm-sentido"
          />
          <div class="barra">
            <SanteBotao
              tipo="submit"
              :rotulo="t('portaria.terminais.gravar')"
              :desabilitado="
                !pode ||
                form.nome.trim().length < 2 ||
                form.tipoTerminal === null ||
                form.local.trim().length < 2
              "
              data-testid="tm-gravar"
            />
            <SanteBotao
              v-if="editando"
              variante="texto"
              :rotulo="t('portaria.cancelar')"
              @acionar="editar(null)"
            />
          </div>
        </form>
      </section>

      <section class="cartao" aria-labelledby="tm-regras-titulo" data-testid="tm-regras-acesso">
        <h2 id="tm-regras-titulo">{{ t('portaria.terminais.regrasAcesso.titulo') }}</h2>
        <p class="secundario">{{ t('portaria.terminais.regrasAcesso.ajuda') }}</p>
        <p v-if="p.regrasAcesso.length === 0">{{ t('portaria.terminais.regrasAcesso.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="tm-regras">
            <thead>
              <tr>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.terminal') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.perfil') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.setor') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.dias') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.faixa') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.sentidos') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.vigencia') }}</th>
                <th scope="col">{{ t('portaria.terminais.regrasAcesso.ativo') }}</th>
                <th scope="col">{{ t('portaria.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in p.regrasAcesso" :key="x.id" :data-testid="`tm-regra-${x.id}`">
                <td>{{ nomeTerminal(x.terminal) }}</td>
                <td>{{ nomePerfil(x.perfil) }}</td>
                <td>{{ nomeSetor(x.setor) }}</td>
                <td>{{ diasTexto(x.diasSemana) }}</td>
                <td>{{ `${x.horaInicio.slice(0, 5)}–${x.horaFim.slice(0, 5)}` }}</td>
                <td>
                  {{
                    [
                      x.entrada ? t('portaria.terminais.sentidos.entrada') : '',
                      x.saida ? t('portaria.terminais.sentidos.saida') : '',
                    ]
                      .filter((y) => y)
                      .join(', ')
                  }}
                </td>
                <td>{{ `${x.vigenciaInicio} → ${x.vigenciaFim ?? '…'}` }}</td>
                <td>{{ x.ativo ? t('portaria.sim') : t('portaria.nao') }}</td>
                <td>
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portaria.regras.editar')"
                    :desabilitado="!pode"
                    @acionar="editarRegra(x)"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="
                      x.ativo
                        ? t('portaria.terminais.regrasAcesso.desativar')
                        : t('portaria.terminais.regrasAcesso.reativar')
                    "
                    :desabilitado="!pode"
                    :data-testid="`tm-regra-alternar-${x.id}`"
                    @acionar="alternarRegra(x)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form class="registro" data-testid="tm-regra-form" @submit.prevent="gravarRegra">
          <h3>
            {{
              regraEditando
                ? t('portaria.terminais.regrasAcesso.alterar')
                : t('portaria.terminais.regrasAcesso.nova')
            }}
          </h3>
          <div class="campos">
            <SanteSelecao
              v-model="regra.terminal"
              :rotulo="t('portaria.terminais.regrasAcesso.terminal')"
              :opcoes="opcoesTerminal"
              :desabilitado="regraEditando !== null"
              data-testid="tm-regra-terminal"
            />
            <SanteSelecao
              v-model="regra.perfil"
              :rotulo="t('portaria.terminais.regrasAcesso.perfil')"
              :opcoes="opcoesPerfil"
              data-testid="tm-regra-perfil"
            />
            <SanteSelecao
              v-model="regra.setor"
              :rotulo="t('portaria.terminais.regrasAcesso.setor')"
              :opcoes="opcoesSetor"
              data-testid="tm-regra-setor"
            />
            <span class="campo">
              <label for="tm-regra-inicio">{{ t('portaria.terminais.regrasAcesso.horaInicio') }}</label>
              <input
                id="tm-regra-inicio"
                v-model="regra.horaInicio"
                type="time"
                data-testid="tm-regra-inicio"
              />
            </span>
            <span class="campo">
              <label for="tm-regra-fim">{{ t('portaria.terminais.regrasAcesso.horaFim') }}</label>
              <input id="tm-regra-fim" v-model="regra.horaFim" type="time" data-testid="tm-regra-fim" />
            </span>
            <span class="campo">
              <label for="tm-regra-vig-ini">{{ t('portaria.terminais.regrasAcesso.vigenciaInicio') }}</label>
              <input
                id="tm-regra-vig-ini"
                v-model="regra.vigenciaInicio"
                type="date"
                data-testid="tm-regra-vig-ini"
              />
            </span>
            <span class="campo">
              <label for="tm-regra-vig-fim">{{ t('portaria.terminais.regrasAcesso.vigenciaFim') }}</label>
              <input
                id="tm-regra-vig-fim"
                v-model="regra.vigenciaFim"
                type="date"
                data-testid="tm-regra-vig-fim"
              />
            </span>
            <span class="campo">
              <label for="tm-regra-prioridade">{{ t('portaria.terminais.regrasAcesso.prioridade') }}</label>
              <input
                id="tm-regra-prioridade"
                v-model.number="regra.prioridade"
                type="number"
                min="0"
                max="999"
                data-testid="tm-regra-prioridade"
              />
            </span>
          </div>
          <p class="secundario">{{ t('portaria.terminais.regrasAcesso.faixaAjuda') }}</p>
          <fieldset class="barra" data-testid="tm-regra-dias">
            <legend>{{ t('portaria.terminais.regrasAcesso.dias') }}</legend>
            <label v-for="d in DIAS" :key="d"
              ><input
                v-model="regra.diasSemana"
                type="checkbox"
                :value="d"
                :data-testid="`tm-regra-dia-${d}`"
              />
              {{ t(`portaria.terminais.regrasAcesso.diasCurtos.${d}`) }}</label
            >
          </fieldset>
          <div class="barra">
            <label
              ><input v-model="regra.entrada" type="checkbox" data-testid="tm-regra-entrada" />
              {{ t('portaria.terminais.regrasAcesso.entrada') }}</label
            >
            <label
              ><input v-model="regra.saida" type="checkbox" data-testid="tm-regra-saida" />
              {{ t('portaria.terminais.regrasAcesso.saida') }}</label
            >
            <label
              ><input v-model="regra.ativo" type="checkbox" data-testid="tm-regra-ativo" />
              {{ t('portaria.terminais.regrasAcesso.ativo') }}</label
            >
          </div>
          <ul v-if="problemasRegra.length > 0" class="alerta" role="alert" data-testid="tm-regra-problemas">
            <li v-for="x in problemasRegra" :key="x">{{ x }}</li>
          </ul>
          <div class="barra">
            <SanteBotao
              tipo="submit"
              :rotulo="t('portaria.terminais.regrasAcesso.gravar')"
              :desabilitado="!pode || regra.terminal === null || problemasRegra.length > 0"
              data-testid="tm-regra-gravar"
            />
            <SanteBotao
              v-if="regraEditando"
              variante="texto"
              :rotulo="t('portaria.cancelar')"
              @acionar="editarRegra(null)"
            />
          </div>
        </form>
      </section>

      <section class="cartao" aria-labelledby="tm-cracha-titulo" data-testid="tm-cracha">
        <h2 id="tm-cracha-titulo">{{ t('portaria.terminais.cracha.titulo') }}</h2>
        <p class="secundario">{{ t('portaria.terminais.cracha.ajuda') }}</p>
        <form class="campos" @submit.prevent="ligarCracha(false)">
          <span class="campo">
            <label for="tm-cracha-matricula">{{ t('portaria.terminais.cracha.matricula') }}</label>
            <input
              id="tm-cracha-matricula"
              v-model="crachaCol.matricula"
              maxlength="30"
              data-testid="tm-cracha-matricula"
            />
          </span>
          <span class="campo">
            <label for="tm-cracha-codigo">{{ t('portaria.terminais.cracha.codigo') }}</label>
            <input
              id="tm-cracha-codigo"
              v-model="crachaCol.codigo"
              maxlength="20"
              :aria-invalid="crachaCol.codigo !== '' && !codigoCrachaOk"
              aria-describedby="tm-cracha-codigo-ajuda"
              data-testid="tm-cracha-codigo"
            />
            <small
              id="tm-cracha-codigo-ajuda"
              :class="{ alerta: crachaCol.codigo !== '' && !codigoCrachaOk }"
              >{{ t('portaria.terminais.cracha.codigoInvalido') }}</small
            >
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('portaria.terminais.cracha.ligar')"
            :desabilitado="!pode || crachaCol.matricula.trim() === '' || !codigoCrachaOk"
            data-testid="tm-cracha-ligar"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('portaria.terminais.cracha.retirar')"
            :desabilitado="!pode || crachaCol.matricula.trim() === ''"
            data-testid="tm-cracha-retirar"
            @acionar="ligarCracha(true)"
          />
        </form>
      </section>

      <section v-if="p.simulador" class="cartao" aria-labelledby="tm-simulador" data-testid="tm-simulador">
        <h2 id="tm-simulador">{{ t('portaria.terminais.simulador') }}</h2>
        <p class="secundario">{{ t('portaria.terminais.simuladorAjuda') }}</p>
        <form class="campos" @submit.prevent="simular">
          <SanteSelecao
            v-model="sim.terminal"
            :rotulo="t('portaria.terminais.terminal')"
            :opcoes="opcoesTerminal"
            data-testid="tm-sim-terminal"
          />
          <span class="campo">
            <label for="tm-sim-cracha">{{ t('portaria.abertas.cracha') }}</label>
            <input id="tm-sim-cracha" v-model="sim.cracha" maxlength="20" data-testid="tm-sim-cracha" />
          </span>
          <SanteSelecao
            v-model="sim.sentido"
            :rotulo="t('portaria.terminais.sentido')"
            :opcoes="opcoesSentidoCatraca"
            data-testid="tm-sim-sentido"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('portaria.terminais.passar')"
            :desabilitado="!pode || !p.catracaLigada || sim.terminal === null || sim.cracha.trim().length < 6"
            data-testid="tm-sim-passar"
          />
        </form>
        <p v-if="resultado" role="status" data-testid="tm-sim-resultado">{{ resultado }}</p>
      </section>

      <section aria-labelledby="tm-eventos">
        <h2 id="tm-eventos">{{ t('portaria.terminais.eventos') }}</h2>
        <p v-if="p.eventos.length === 0">{{ t('portaria.terminais.semEventos') }}</p>
        <ul v-else class="lista" data-testid="tm-eventos">
          <li v-for="e in p.eventos" :key="e.id">
            {{ hora(e.ocorridoEm) }} · {{ e.terminalNome }} ·
            {{ t(`portaria.terminais.sentidos.${e.sentido}`) }} · {{ e.cracha }} ·
            <strong :class="e.resultado === 'liberado' ? 'ok' : 'alerta'">{{
              e.resultado === 'liberado'
                ? t('portaria.terminais.liberado')
                : t('portaria.terminais.negado', { motivo: textoMotivo(e.motivo) })
            }}</strong>
          </li>
        </ul>
      </section>

      <GrupoDominiosTela subitem="portariaTerminais" embutida />
    </template>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
