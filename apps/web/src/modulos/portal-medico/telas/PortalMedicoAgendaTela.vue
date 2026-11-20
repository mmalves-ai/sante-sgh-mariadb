<script setup lang="ts">
// Agenda cirúrgica do cirurgião externo (ficha do M50, seção 7; regra 6; DP-43): `/medico-externo/agenda`, no portal
// (fora da casca interna). O servidor devolve só as cirurgias em que o registro do profissional ligado à conta é o
// cirurgião (o paciente mascarado, como no mapa do bloco) e os pedidos feitos por esta conta. O pedido de cirurgia fica
// solicitado, sem ocupar a sala, até a secretaria do bloco confirmar; o médico retira o próprio pedido ainda não
// confirmado. W0-10: ele também o altera (o mesmo formulário, com o motivo e o painel de confirmação; a versão anterior
// fica visível na linha do pedido; o confirmado devolve 409).
import type { PedidoCirurgiaPortal, PedidoPortalMedico } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  agendaPortalMedico,
  alterarPedidoPortal,
  opcoesPortalMedico,
  pedirCirurgiaPortal,
  procedimentosPortalMedico,
  retirarPedidoPortal,
} from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const pronto = ref(false);
const de = ref('');
const ate = ref('');
const periodo = ref<{ de: string | null; ate: string | null }>({ de: null, ate: null });
const agenda = useQuery({
  queryKey: computed(() => ['portal-medico', 'agenda', periodo.value]),
  queryFn: () => agendaPortalMedico(periodo.value.de, periodo.value.ate),
  enabled: pronto,
});
const opcoes = useQuery({
  queryKey: ['portal-medico', 'opcoes'],
  queryFn: () => opcoesPortalMedico(),
  enabled: computed(() => pronto.value && !!agenda.data.value?.podePedir),
});
function ver(): void {
  periodo.value = { de: de.value || null, ate: ate.value || null };
}
const data = (d: string) => d.split('-').reverse().join('/');

// ── Pedido ──
const fSala = ref('');
const fData = ref('');
const fHora = ref('');
const fDuracao = ref('60');
const fConvenio = ref('');
const fCarater = ref('2');
const fAnestesia = ref('');
const fNome = ref('');
const fNascimento = ref('');
const fObservacao = ref('');
const termoProc = ref('');
const procs = ref<{ codigo: number; nome: string }[]>([]);
const procedimento = ref<{ codigo: number; nome: string } | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const comVazio = (l: { valor: string; rotulo: string }[], rotulo = t('portalMedico.pedido.escolha')) => [
  { valor: '', rotulo },
  ...l,
];
const salas = computed(() =>
  comVazio((opcoes.data.value?.salas ?? []).map((s) => ({ valor: String(s.codigo), rotulo: s.nome }))),
);
const convenios = computed(() =>
  comVazio((opcoes.data.value?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome }))),
);
const caracteres = computed(() =>
  (opcoes.data.value?.caracteres ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
);
const anestesias = computed(() =>
  comVazio(
    (opcoes.data.value?.anestesias ?? []).map((a) => ({ valor: String(a.codigo), rotulo: a.nome })),
    t('portalMedico.pedido.naoInformada'),
  ),
);
const hhmm = (v: string) => {
  const d = v.replace(/\D/g, '');
  return /^([01]\d|2[0-3])[0-5]\d$/.test(d) ? d : null;
};
const podeEnviar = computed(
  () =>
    !!fSala.value &&
    !!fData.value &&
    hhmm(fHora.value) !== null &&
    Number(fDuracao.value) > 0 &&
    procedimento.value !== null &&
    !!fConvenio.value &&
    fNome.value.trim().length >= 5 &&
    !!fNascimento.value,
);
async function procurar(): Promise<void> {
  procs.value =
    termoProc.value.trim().length >= 3 ? await procedimentosPortalMedico(termoProc.value.trim()) : [];
}
function entrada(codigo: number): PedidoCirurgiaPortal {
  return {
    sala: Number(fSala.value),
    data: fData.value,
    hora: hhmm(fHora.value) ?? '',
    duracaoMin: Number(fDuracao.value),
    procedimento: codigo,
    convenio: Number(fConvenio.value),
    carater: Number(fCarater.value),
    anestesia: fAnestesia.value ? Number(fAnestesia.value) : 0,
    paciente: { nome: fNome.value, nascimento: fNascimento.value },
    ...(fObservacao.value.trim() ? { observacao: fObservacao.value } : {}),
  };
}
function limpar(): void {
  fNome.value = '';
  fNascimento.value = '';
  fObservacao.value = '';
  fMotivo.value = '';
  procedimento.value = null;
  editando.value = null;
  revisando.value = false;
}
async function pedir(): Promise<void> {
  if (!podeEnviar.value || !procedimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await pedirCirurgiaPortal(entrada(procedimento.value.codigo));
    mensagem.value = r.mensagem;
    limpar();
    await cliente.invalidateQueries({ queryKey: ['portal-medico', 'agenda'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── W0-10: alteração do pedido ainda não confirmado ──
const editando = ref<PedidoPortalMedico | null>(null);
const fMotivo = ref('');
const revisando = ref(false);
const podeRevisar = computed(() => podeEnviar.value && fMotivo.value.trim().length >= 5);
function alterarInicio(p: PedidoPortalMedico): void {
  const e = p.edicao;
  if (!e) return;
  erro.value = null;
  mensagem.value = null;
  editando.value = p;
  revisando.value = false;
  fMotivo.value = '';
  fSala.value = String(e.sala);
  fData.value = e.data;
  fHora.value = e.hora;
  fDuracao.value = String(e.duracaoMin);
  fConvenio.value = String(e.convenio);
  fCarater.value = String(e.carater);
  fAnestesia.value = e.anestesia ? String(e.anestesia) : '';
  fNome.value = p.paciente;
  fNascimento.value = p.nascimento ?? '';
  fObservacao.value = e.observacao ?? '';
  procedimento.value = { codigo: e.procedimento, nome: p.procedimento };
  procs.value = [];
}
function enviar(): void {
  if (editando.value) {
    if (podeRevisar.value) revisando.value = true;
  } else void pedir();
}
async function confirmarAlteracao(): Promise<void> {
  const p = editando.value;
  if (!p || !procedimento.value || !podeRevisar.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await alterarPedidoPortal(p.id, {
      ...entrada(procedimento.value.codigo),
      versao: p.versao,
      motivo: fMotivo.value,
    });
    mensagem.value = r.mensagem;
    limpar();
    await cliente.invalidateQueries({ queryKey: ['portal-medico', 'agenda'] });
  } catch (x) {
    erro.value = x;
    revisando.value = false;
  } finally {
    ocupado.value = false;
  }
}
async function retirar(p: PedidoPortalMedico): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await retirarPedidoPortal(p.id, null)).mensagem;
    await cliente.invalidateQueries({ queryKey: ['portal-medico', 'agenda'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.agenda.titulo')" @sessao="pronto = true">
    <form class="filtros" @submit.prevent="ver">
      <span class="campo">
        <label for="pm-de">{{ t('portalMedico.agenda.de') }}</label>
        <input id="pm-de" v-model="de" type="date" data-testid="pm-de" />
      </span>
      <span class="campo">
        <label for="pm-ate">{{ t('portalMedico.agenda.ate') }}</label>
        <input id="pm-ate" v-model="ate" type="date" data-testid="pm-ate" />
      </span>
      <button type="submit" data-testid="pm-ver">{{ t('portalMedico.agenda.ver') }}</button>
    </form>
    <ErroPortalMedico v-if="agenda.error.value" :erro="agenda.error.value" />
    <p v-else-if="!agenda.data.value" role="status">{{ t('portalMedico.carregando') }}</p>
    <p v-else-if="!agenda.data.value.vinculado" role="note" data-testid="pm-sem-vinculo">
      {{ t('portalMedico.semVinculo') }}
    </p>
    <template v-else>
      <p class="secundario">{{ t('portalMedico.profissional', { nome: agenda.data.value.profissional }) }}</p>
      <h2>{{ t('portalMedico.agenda.cirurgias') }}</h2>
      <p v-if="agenda.data.value.truncado" role="note">{{ t('portalMedico.agenda.cortada') }}</p>
      <table v-if="agenda.data.value.agendamentos.length" class="tabela" data-testid="pm-agendamentos">
        <thead>
          <tr>
            <th scope="col">{{ t('portalMedico.agenda.data') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.hora') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.duracao') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.sala') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.paciente') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.procedimento') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.convenio') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in agenda.data.value.agendamentos" :key="a.agendamento ?? `${a.data}${a.hora}`">
            <td>{{ data(a.data) }}</td>
            <td>{{ a.hora }}</td>
            <td>{{ t('portalMedico.agenda.duracaoMin', { n: a.duracaoMin }) }}</td>
            <td>{{ a.sala }}</td>
            <td>{{ a.paciente }}</td>
            <td>{{ a.procedimento }}</td>
            <td>{{ a.convenio }}</td>
            <td>{{ a.estadoRotulo }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('portalMedico.nenhum') }}</p>

      <h2>{{ t('portalMedico.agenda.pedidos') }}</h2>
      <table v-if="agenda.data.value.pedidos.length" class="tabela" data-testid="pm-pedidos">
        <thead>
          <tr>
            <th scope="col">{{ t('portalMedico.agenda.data') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.hora') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.sala') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.paciente') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.procedimento') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.situacao') }}</th>
            <th scope="col">{{ t('portalMedico.agenda.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in agenda.data.value.pedidos" :key="p.id" :data-testid="`pm-pedido-${p.id}`">
            <td>{{ data(p.data) }}</td>
            <td>{{ p.hora }}</td>
            <td>{{ p.sala }}</td>
            <td>{{ p.paciente }}</td>
            <td>
              {{ p.procedimento }}
              <details v-if="p.versoes.length" :data-testid="`pm-versoes-${p.id}`">
                <summary>{{ t('portalMedico.agenda.versoesAnteriores', { n: p.versoes.length }) }}</summary>
                <ul>
                  <li v-for="v in p.versoes" :key="v.versao">
                    {{
                      t('portalMedico.agenda.versaoAnterior', {
                        versao: v.versao,
                        data: data(v.data),
                        hora: v.hora,
                        duracao: v.duracaoMin,
                        sala: v.sala,
                        procedimento: v.procedimento,
                        convenio: v.convenio,
                        quando: `${data(v.substituidaEm.slice(0, 10))} ${v.substituidaEm.slice(11, 16)}`,
                        motivo: v.motivo,
                      })
                    }}
                  </li>
                </ul>
              </details>
            </td>
            <td :data-testid="`pm-pedido-situacao-${p.id}`">
              {{ p.estadoRotulo }}
              <span v-if="p.versao > 1" class="secundario">{{
                t('portalMedico.agenda.versao', { n: p.versao })
              }}</span>
            </td>
            <td>
              {{ p.motivo ?? '' }}
              <SanteBotao
                v-if="p.edicao && agenda.data.value.podePedir"
                variante="secundario"
                :rotulo="t('portalMedico.agenda.alterar')"
                :data-testid="`pm-alterar-${p.id}`"
                @acionar="alterarInicio(p)"
              />
              <SanteBotao
                v-if="p.retiravel"
                variante="destrutivo"
                :rotulo="t('portalMedico.agenda.retirar')"
                :confirmacao="t('portalMedico.agenda.retirarPergunta', { paciente: p.paciente })"
                :data-testid="`pm-retirar-${p.id}`"
                @acionar="retirar(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('portalMedico.nenhum') }}</p>

      <section class="painel" aria-labelledby="pm-pedido-titulo" data-testid="pm-form-pedido">
        <h2 id="pm-pedido-titulo">
          {{
            editando
              ? t('portalMedico.pedido.alterarTitulo', {
                  paciente: editando.paciente,
                  versao: editando.versao,
                })
              : t('portalMedico.pedido.titulo')
          }}
        </h2>
        <p v-if="!agenda.data.value.podePedir" role="note" data-testid="pm-pedido-desligado">
          {{ t('portalMedico.pedido.desligado') }}
        </p>
        <template v-else>
          <p class="secundario">
            {{ editando ? t('portalMedico.pedido.alterarAjuda') : t('portalMedico.pedido.ajuda') }}
          </p>
          <div class="filtros">
            <span class="campo">
              <label for="pm-nome">{{ t('portalMedico.pedido.pacienteNome') }}</label>
              <input id="pm-nome" v-model="fNome" maxlength="70" autocomplete="off" data-testid="pm-nome" />
            </span>
            <span class="campo">
              <label for="pm-nasc">{{ t('portalMedico.pedido.pacienteNascimento') }}</label>
              <input id="pm-nasc" v-model="fNascimento" type="date" data-testid="pm-nascimento" />
            </span>
          </div>
          <div class="filtros">
            <SanteSelecao
              v-model="fSala"
              :rotulo="t('portalMedico.pedido.sala')"
              :opcoes="salas"
              data-testid="pm-sala"
            />
            <span class="campo">
              <label for="pm-data">{{ t('portalMedico.pedido.data') }}</label>
              <input id="pm-data" v-model="fData" type="date" data-testid="pm-data" />
            </span>
            <span class="campo">
              <label for="pm-hora">{{ t('portalMedico.pedido.hora') }}</label>
              <input id="pm-hora" v-model="fHora" inputmode="numeric" maxlength="5" data-testid="pm-hora" />
            </span>
            <span class="campo">
              <label for="pm-duracao">{{ t('portalMedico.pedido.duracao') }}</label>
              <input
                id="pm-duracao"
                v-model="fDuracao"
                type="number"
                min="5"
                max="1439"
                step="5"
                data-testid="pm-duracao"
              />
            </span>
          </div>
          <form class="filtros" role="search" @submit.prevent="procurar">
            <span class="campo">
              <label for="pm-proc">{{ t('portalMedico.pedido.procedimento') }}</label>
              <input
                id="pm-proc"
                v-model="termoProc"
                type="search"
                autocomplete="off"
                data-testid="pm-procedimento"
              />
            </span>
            <SanteBotao tipo="submit" variante="secundario" :rotulo="t('portalMedico.pedido.buscar')" />
          </form>
          <ul v-if="procs.length && !procedimento">
            <li v-for="p in procs" :key="p.codigo">
              <SanteBotao
                variante="texto"
                :rotulo="t('portalMedico.pedido.escolher', { nome: `${p.nome} (${p.codigo})` })"
                :data-testid="`pm-proc-${p.codigo}`"
                @acionar="procedimento = p"
              />
            </li>
          </ul>
          <p v-if="procedimento" class="acoes" data-testid="pm-proc-escolhido">
            {{ t('portalMedico.pedido.escolhido', { nome: procedimento.nome }) }}
            <SanteBotao
              variante="texto"
              :rotulo="t('portalMedico.pedido.trocar')"
              @acionar="procedimento = null"
            />
          </p>
          <div class="filtros">
            <SanteSelecao
              v-model="fConvenio"
              :rotulo="t('portalMedico.pedido.convenio')"
              :opcoes="convenios"
              data-testid="pm-convenio"
            />
            <SanteSelecao
              v-model="fCarater"
              :rotulo="t('portalMedico.pedido.carater')"
              :opcoes="caracteres"
              data-testid="pm-carater"
            />
            <SanteSelecao
              v-model="fAnestesia"
              :rotulo="t('portalMedico.pedido.anestesia')"
              :opcoes="anestesias"
              data-testid="pm-anestesia"
            />
          </div>
          <span class="campo">
            <label for="pm-obs">{{ t('portalMedico.pedido.observacao') }}</label>
            <input id="pm-obs" v-model="fObservacao" maxlength="150" data-testid="pm-observacao" />
          </span>
          <span v-if="editando" class="campo">
            <label for="pm-motivo">{{ t('portalMedico.pedido.motivo') }}</label>
            <input id="pm-motivo" v-model="fMotivo" maxlength="200" data-testid="pm-motivo" />
          </span>
          <div
            v-if="editando && revisando"
            class="painel"
            role="alertdialog"
            data-testid="pm-alteracao-confirmar"
          >
            <h3>{{ t('portalMedico.pedido.confirmarTitulo') }}</h3>
            <p>
              {{
                t('portalMedico.pedido.confirmarTexto', {
                  data: data(fData),
                  hora: fHora,
                  duracao: fDuracao,
                  procedimento: procedimento?.nome ?? '',
                  motivo: fMotivo.trim(),
                })
              }}
            </p>
            <p class="acoes">
              <SanteBotao
                :rotulo="t('portalMedico.pedido.confirmar')"
                :desabilitado="ocupado"
                data-testid="pm-alteracao-sim"
                @acionar="confirmarAlteracao"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('portalMedico.pedido.voltar')"
                @acionar="revisando = false"
              />
            </p>
          </div>
          <p v-else class="acoes">
            <SanteBotao
              :rotulo="editando ? t('portalMedico.pedido.revisar') : t('portalMedico.pedido.enviar')"
              :desabilitado="ocupado || !(editando ? podeRevisar : podeEnviar)"
              data-testid="pm-pedir"
              @acionar="enviar"
            />
            <SanteBotao
              v-if="editando"
              variante="texto"
              :rotulo="t('portalMedico.pedido.desistir')"
              data-testid="pm-alteracao-desistir"
              @acionar="limpar"
            />
          </p>
        </template>
      </section>
      <p v-if="mensagem" role="status" data-testid="pm-mensagem">{{ mensagem }}</p>
      <ErroPortalMedico v-if="erro" :erro="erro" />
    </template>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
