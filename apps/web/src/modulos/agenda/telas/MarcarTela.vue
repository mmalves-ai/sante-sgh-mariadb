<script setup lang="ts">
// Marcação de consulta (ficha do M17, seção 7): `/agenda/consultas/marcar`. Busca de vaga por agenda,
// especialidade, profissional, convênio e turno (próximo livre quando a janela não tem vaga; cobertura com as
// alternativas), escolha do paciente no cadastro único, convênio, retorno, canal e recado → agenda.agendarConsulta.
// O encaixe (minuto fora da grade, com motivo) → agenda.encaixar, com a conferência antes.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { BuscaVagas, ResultadoBuscaPaciente } from '@sgh/contratos';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  avaliarEncaixe,
  buscarVagas,
  codigoDaRecusa,
  encaixar,
  lerMarcacoesPaciente,
  marcarConsulta,
  novaChave,
} from '../api-agenda.js';
import AlertaCredenciamentoMarcacao from '../componentes/AlertaCredenciamentoMarcacao.vue';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr, horaDoContrato } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const { opcoes, opcoesAgenda, pode, motivoGravacao } = usarAgenda();
const q = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');

// ── Busca de vaga ──
const fAgenda = ref(q('agenda'));
const fEspecialidade = ref('');
const fProfissional = ref('');
const fConvenio = ref('');
const fTurno = ref('');
const fUnidade = ref('');
const fLocal = ref('');
const fDe = ref(q('data'));
const fAte = ref(q('data'));
const busca = ref<BuscaVagas | null>(null);
const erroBusca = ref<unknown>(null);
const comVazio = (l: { valor: string; rotulo: string }[], rotulo = t('agenda.escolha')) => [
  { valor: '', rotulo },
  ...l,
];
const agendas = computed(() => comVazio(opcoesAgenda.value, t('agenda.todas')));
const especialidades = computed(() =>
  comVazio(
    (opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
  ),
);
const convenios = computed(() =>
  comVazio(
    (opcoes.data.value?.convenios ?? [])
      .filter((c) => c.ativo)
      .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ),
);
const canais = computed(() =>
  (opcoes.data.value?.canais ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const unidades = computed(() =>
  comVazio(
    (opcoes.data.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome })),
    t('agenda.todasUnidades'),
  ),
);
const locais = computed(() =>
  comVazio(
    (opcoes.data.value?.locais ?? []).map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
    t('agenda.todosLocais'),
  ),
);
/** O canal escolhido tem o código em conferência (legenda "a confirmar"). */
const canalAConfirmar = computed(
  () => opcoes.data.value?.canais.find((c) => c.codigo === canal.value)?.aConfirmar ?? false,
);
const turnos = computed(() =>
  comVazio(
    (['manha', 'tarde', 'noite'] as const).map((v) => ({ valor: v, rotulo: t(`agenda.turnos.${v}`) })),
    t('agenda.turnos.todos'),
  ),
);
async function procurar(): Promise<void> {
  erroBusca.value = null;
  try {
    busca.value = await buscarVagas({
      agenda: fAgenda.value ? Number(fAgenda.value) : null,
      especialidade: fEspecialidade.value ? Number(fEspecialidade.value) : null,
      profissional: fProfissional.value.trim() || null,
      convenio: fConvenio.value ? Number(fConvenio.value) : null,
      turno: fTurno.value || null,
      de: fDe.value || null,
      ate: fAte.value || null,
      unidade: fUnidade.value ? Number(fUnidade.value) : null,
      local: fLocal.value ? Number(fLocal.value) : null,
    });
  } catch (e) {
    erroBusca.value = e;
  }
}

// ── Vaga escolhida ──
interface Escolha {
  agenda: number;
  nomeAgenda: string;
  data: string;
  hora: string;
}
const nomeDaAgenda = (id: number) =>
  opcoesAgenda.value.find((a) => a.valor === String(id))?.rotulo ?? String(id);
const escolha = ref<Escolha | null>(
  q('agenda') && q('data') && q('hora')
    ? { agenda: Number(q('agenda')), nomeAgenda: '', data: q('data'), hora: q('hora') }
    : null,
);
function escolher(v: { agenda: number; nomeAgenda: string; data: string; hora: string }): void {
  escolha.value = { ...v };
  if (fConvenio.value) convenio.value = fConvenio.value;
}

// ── Paciente ──
const termo = ref('');
const pedidoPaciente = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['agenda', 'pacientes', pedidoPaciente.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedidoPaciente.value),
  enabled: computed(() => pedidoPaciente.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['agenda', 'paciente', paciente.value?.id ?? 0]),
  queryFn: () => lerMarcacoesPaciente(paciente.value?.id ?? 0),
  enabled: computed(() => paciente.value !== null),
});

// ── Marcação ──
const convenio = ref('');
const retorno = ref(false);
const canal = ref('telefone');
const observacao = ref('');
const chave = ref(novaChave('marcar'));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
/** Próximo horário livre da mesma agenda quando o escolhido foi ocupado por outro terminal. */
const sugestao = ref<{ agenda: number; nomeAgenda: string; data: string; hora: string } | null>(null);
const semSugestao = ref(false);
async function sugerirProximo(e: Escolha): Promise<void> {
  sugestao.value = null;
  semSugestao.value = false;
  try {
    const ate = new Date(`${e.data}T00:00:00Z`);
    ate.setUTCDate(ate.getUTCDate() + 13);
    const r = await buscarVagas({ agenda: e.agenda, de: e.data, ate: ate.toISOString().slice(0, 10) });
    const alvo = `${e.data} ${horaBr(e.hora)}`;
    const proxima =
      r.vagas.find((v) => `${v.data} ${horaBr(v.hora)}` > alvo) ??
      r.proximas.find((v) => v.agenda === e.agenda);
    if (proxima) sugestao.value = { ...proxima };
    else semSugestao.value = true;
    if (busca.value) await procurar();
  } catch {
    semSugestao.value = true;
  }
}
function usarSugestao(): void {
  if (sugestao.value) escolher(sugestao.value);
  sugestao.value = null;
  erro.value = null;
}
const podeMarcar = pode('agenda.agendarConsulta');
const podeEncaixar = pode('agenda.encaixar');
// ADR 0009, decisão 25: profissional não credenciado no convênio gera alerta; com o bloqueio do convênio, não marca.
const efeitoCredenciamento = ref<'nenhum' | 'alerta' | 'bloqueio' | null>(null);
const pronto = computed(
  () =>
    escolha.value !== null &&
    paciente.value !== null &&
    convenio.value !== '' &&
    efeitoCredenciamento.value !== 'bloqueio',
);

async function marcar(): Promise<void> {
  const e = escolha.value;
  const p = paciente.value;
  if (!e || !p) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await marcarConsulta(
      {
        agenda: e.agenda,
        data: e.data,
        hora: horaDoContrato(e.hora) ?? e.hora,
        paciente: p.id,
        convenio: Number(convenio.value),
        retorno: retorno.value,
        canal: canal.value,
        ...(observacao.value.trim() ? { observacao: observacao.value } : {}),
      },
      chave.value,
    );
    mensagem.value = t('agenda.marcar.marcada');
    chave.value = novaChave('marcar');
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
    const id = Number(r.resultado['marcacao']);
    if (id) await roteador.push(`/agenda/consultas/marcacoes/${id}`);
  } catch (x) {
    erro.value = x;
    chave.value = novaChave('marcar');
    if (codigoDaRecusa(x) === 'horario-ocupado') await sugerirProximo(e);
  } finally {
    ocupado.value = false;
  }
}

// ── Encaixe ──
const eAgenda = ref(q('agenda'));
const eData = ref(q('data'));
const eHora = ref('');
const eMotivo = ref('');
const avaliacao = ref<Awaited<ReturnType<typeof avaliarEncaixe>> | null>(null);
async function conferirEncaixe(): Promise<void> {
  erro.value = null;
  avaliacao.value = null;
  try {
    avaliacao.value = await avaliarEncaixe(Number(eAgenda.value), eData.value, eHora.value);
  } catch (x) {
    erro.value = x;
  }
}
async function fazerEncaixe(): Promise<void> {
  const p = paciente.value;
  if (!p) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await encaixar(
      {
        agenda: Number(eAgenda.value),
        data: eData.value,
        hora: horaDoContrato(eHora.value) ?? eHora.value,
        paciente: p.id,
        convenio: Number(convenio.value),
        retorno: retorno.value,
        canal: canal.value,
        motivo: eMotivo.value,
        ...(observacao.value.trim() ? { observacao: observacao.value } : {}),
      },
      novaChave('encaixe'),
    );
    mensagem.value = t('agenda.marcar.encaixado');
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
    const id = Number(r.resultado['marcacao']);
    if (id) await roteador.push(`/agenda/consultas/marcacoes/${id}`);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="marcar-titulo" data-testid="tela-marcar">
    <h1 id="marcar-titulo">{{ t('agenda.marcar.titulo') }}</h1>
    <p>{{ t('agenda.marcar.texto') }}</p>
    <AvisoGravacao :motivo="motivoGravacao" />
    <p>
      <RouterLink to="/agenda/consultas/dia">{{ t('agenda.dia.titulo') }}</RouterLink>
    </p>

    <section class="painel" aria-labelledby="marcar-busca">
      <h2 id="marcar-busca">{{ t('agenda.marcar.buscar') }}</h2>
      <form class="filtros" role="search" @submit.prevent="procurar">
        <SanteSelecao v-model="fAgenda" :rotulo="t('agenda.agenda')" :opcoes="agendas" />
        <SanteSelecao
          v-model="fEspecialidade"
          :rotulo="t('agenda.marcar.especialidade')"
          :opcoes="especialidades"
        />
        <div class="campo">
          <label for="marcar-prof">{{ t('agenda.marcar.profissional') }}</label>
          <input id="marcar-prof" v-model="fProfissional" type="search" autocomplete="off" />
        </div>
        <SanteSelecao v-model="fConvenio" :rotulo="t('agenda.convenio')" :opcoes="convenios" />
        <SanteSelecao v-model="fTurno" :rotulo="t('agenda.marcar.turno')" :opcoes="turnos" />
        <SanteSelecao v-model="fUnidade" :rotulo="t('agenda.unidade')" :opcoes="unidades" />
        <SanteSelecao v-model="fLocal" :rotulo="t('agenda.local')" :opcoes="locais" />
        <div class="campo">
          <label for="marcar-de">{{ t('agenda.de') }}</label>
          <input id="marcar-de" v-model="fDe" type="date" data-testid="vagas-de" />
        </div>
        <div class="campo">
          <label for="marcar-ate">{{ t('agenda.ate') }}</label>
          <input id="marcar-ate" v-model="fAte" type="date" data-testid="vagas-ate" />
        </div>
        <SanteBotao tipo="submit" :rotulo="t('agenda.marcar.buscar')" />
      </form>
      <ErroAgenda v-if="erroBusca" :erro="erroBusca" />
      <template v-if="busca">
        <SanteAlerta v-if="busca.recortada" variante="info" :texto="t('agenda.recortada', { dias: 31 })" />
        <SanteAlerta
          v-for="r in busca.recusasCobertura"
          :key="r.agenda"
          variante="aviso"
          :texto="
            t('agenda.marcar.cobertura', {
              agenda: r.nomeAgenda,
              aceitos: r.aceitos.map((a) => a.nome).join(', '),
            })
          "
        />
        <p v-for="r in busca.recusasCobertura.filter((x) => x.alternativas.length)" :key="`alt-${r.agenda}`">
          {{ t('agenda.marcar.alternativas', { lista: r.alternativas.join(', ') }) }}
        </p>
        <table v-if="busca.vagas.length" class="tabela" data-testid="tabela-vagas">
          <caption>
            {{
              t('agenda.marcar.vagas', { n: busca.vagas.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agenda.agenda') }}</th>
              <th scope="col">{{ t('agenda.data') }}</th>
              <th scope="col">{{ t('agenda.hora') }}</th>
              <th scope="col">{{ t('agenda.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in busca.vagas" :key="`${v.agenda}-${v.data}-${v.hora}`">
              <td>{{ v.nomeAgenda }}</td>
              <td>{{ dataBr(v.data) }}</td>
              <td>{{ horaBr(v.hora) }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="
                    t('agenda.marcar.escolher', {
                      data: dataBr(v.data),
                      hora: horaBr(v.hora),
                      agenda: v.nomeAgenda,
                    })
                  "
                  :data-testid="`vaga-${v.agenda}-${v.data}-${horaBr(v.hora).replace(':', '')}`"
                  @acionar="escolher(v)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('agenda.nenhuma') }}</p>
        <section v-if="busca.proximas.length" aria-labelledby="marcar-proximas">
          <h3 id="marcar-proximas">{{ t('agenda.marcar.proximas') }}</h3>
          <ul>
            <li v-for="p in busca.proximas" :key="p.agenda">
              <SanteBotao
                variante="texto"
                :rotulo="
                  t('agenda.marcar.escolher', {
                    data: dataBr(p.data),
                    hora: horaBr(p.hora),
                    agenda: p.nomeAgenda,
                  })
                "
                @acionar="escolher(p)"
              />
            </li>
          </ul>
        </section>
      </template>
    </section>

    <section class="painel" aria-labelledby="marcar-paciente">
      <h2 id="marcar-paciente">{{ t('agenda.marcar.buscarPaciente') }}</h2>
      <form class="filtros" role="search" @submit.prevent="pedidoPaciente = termo.trim()">
        <div class="campo">
          <label for="marcar-termo">{{ t('agenda.marcar.termoPaciente') }}</label>
          <input
            id="marcar-termo"
            v-model="termo"
            type="search"
            autocomplete="off"
            data-testid="marcar-termo"
          />
        </div>
        <SanteBotao tipo="submit" :rotulo="t('agenda.marcar.buscarPaciente')" />
      </form>
      <ErroAgenda v-if="pacientes.isError.value" :erro="pacientes.error.value" />
      <ul v-else-if="pacientes.data.value && !paciente">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="t('agenda.marcar.escolherPaciente', { nome: p.nomeSocial ?? p.nome })"
            :data-testid="`paciente-${p.id}`"
            @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
          />
        </li>
      </ul>
      <p v-if="paciente" class="acoes" data-testid="paciente-escolhido">
        {{ t('agenda.marcar.pacienteEscolhido', { nome: paciente.nome }) }}
        <SanteBotao variante="texto" :rotulo="t('agenda.cancelar')" @acionar="paciente = null" />
      </p>
      <section v-if="paciente && historico.data.value?.marcacoes.length" aria-labelledby="marcar-historico">
        <h3 id="marcar-historico">{{ t('agenda.marcar.marcacoesDoPaciente') }}</h3>
        <ul>
          <li v-for="m in historico.data.value.marcacoes.slice(0, 10)" :key="m.id">
            <RouterLink :to="`/agenda/consultas/marcacoes/${m.id}`">
              {{ dataBr(m.data) }} {{ horaBr(m.hora) }} · {{ m.nomeAgenda }} ·
              {{ t(`agenda.estados.${m.estado}`) }}
            </RouterLink>
          </li>
        </ul>
      </section>
      <section
        v-if="
          paciente && (historico.data.value?.possiveis.length || historico.data.value?.preCadastros.length)
        "
        aria-labelledby="marcar-possiveis"
        data-testid="marcacoes-possiveis"
      >
        <h3 id="marcar-possiveis">{{ t('agenda.marcar.possiveis') }}</h3>
        <p class="secundario">{{ t('agenda.marcar.possiveisTexto') }}</p>
        <ul>
          <li v-for="m in historico.data.value?.possiveis.slice(0, 10) ?? []" :key="m.id">
            <RouterLink :to="`/agenda/consultas/marcacoes/${m.id}`">
              {{ dataBr(m.data) }} {{ horaBr(m.hora) }} · {{ m.nomeAgenda }} · {{ m.paciente }}
            </RouterLink>
          </li>
        </ul>
        <template v-if="historico.data.value?.preCadastros.length">
          <h4>{{ t('agenda.marcar.preCadastros') }}</h4>
          <ul>
            <li v-for="(p, i) in historico.data.value.preCadastros.slice(0, 10)" :key="`pre-${i}`">
              {{ p.data ? dataBr(p.data) : '—' }} · {{ p.nomeAgenda }}
            </li>
          </ul>
        </template>
      </section>
    </section>

    <section class="painel" aria-labelledby="marcar-dados">
      <h2 id="marcar-dados">{{ t('agenda.marcar.marcar') }}</h2>
      <p v-if="escolha" data-testid="vaga-escolhida">
        {{
          t('agenda.marcar.escolhida', {
            agenda: escolha.nomeAgenda || nomeDaAgenda(escolha.agenda),
            data: dataBr(escolha.data),
            hora: horaBr(escolha.hora),
          })
        }}
      </p>
      <div class="filtros">
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('agenda.convenio')"
          :opcoes="convenios"
          data-testid="marcar-convenio"
        />
        <SanteSelecao v-model="canal" :rotulo="t('agenda.canal')" :opcoes="canais" />
        <label><input v-model="retorno" type="checkbox" /> {{ t('agenda.marcar.retorno') }}</label>
      </div>
      <AlertaCredenciamentoMarcacao
        v-if="escolha"
        :agenda-id="escolha.agenda"
        :convenio="convenio ? Number(convenio) : null"
        :data="escolha.data"
        @efeito="(e) => (efeitoCredenciamento = e)"
      />
      <p v-if="canalAConfirmar" class="secundario" data-testid="canal-a-confirmar">
        {{ t('agenda.canalAConfirmar') }}
      </p>
      <SanteCampoTexto v-model="observacao" :rotulo="t('agenda.observacao')" :max-bytes="500" multilinha />
      <SanteBotao
        v-if="podeMarcar"
        :rotulo="t('agenda.marcar.marcar')"
        :desabilitado="!pronto || ocupado"
        data-testid="botao-marcar"
        @acionar="marcar"
      />
    </section>

    <section v-if="podeEncaixar" class="painel" aria-labelledby="marcar-encaixe">
      <h2 id="marcar-encaixe">{{ t('agenda.marcar.encaixe') }}</h2>
      <p>{{ t('agenda.marcar.encaixeTexto') }}</p>
      <form class="filtros" @submit.prevent="conferirEncaixe">
        <SanteSelecao v-model="eAgenda" :rotulo="t('agenda.agenda')" :opcoes="comVazio(opcoesAgenda)" />
        <div class="campo">
          <label for="encaixe-data">{{ t('agenda.data') }}</label>
          <input id="encaixe-data" v-model="eData" type="date" required data-testid="encaixe-data" />
        </div>
        <div class="campo">
          <label for="encaixe-hora">{{ t('agenda.hora') }}</label>
          <input
            id="encaixe-hora"
            v-model="eHora"
            inputmode="numeric"
            :placeholder="t('agenda.horaExemplo')"
            required
            data-testid="encaixe-hora"
          />
        </div>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('agenda.marcar.avaliar')"
          :desabilitado="!eAgenda"
        />
      </form>
      <template v-if="avaliacao">
        <SanteAlerta v-for="v in avaliacao.vetos" :key="v.codigo" variante="alerta" :texto="v.texto" />
        <SanteAlerta v-for="a in avaliacao.alertas" :key="a.codigo" variante="aviso" :texto="a.texto" />
      </template>
      <SanteCampoTexto v-model="eMotivo" :rotulo="t('agenda.marcar.motivoEncaixe')" :max-bytes="200" />
      <SanteBotao
        :rotulo="t('agenda.marcar.encaixar')"
        :desabilitado="
          !paciente || !convenio || !eAgenda || !eData || !eHora || eMotivo.trim().length < 5 || ocupado
        "
        data-testid="botao-encaixar"
        @acionar="fazerEncaixe"
      />
    </section>

    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
    <div v-if="sugestao" class="acoes" role="status" data-testid="sugestao-proximo">
      <SanteAlerta
        variante="aviso"
        :texto="
          t('agenda.marcar.ocupadoSugestao', { data: dataBr(sugestao.data), hora: horaBr(sugestao.hora) })
        "
      />
      <SanteBotao
        :rotulo="
          t('agenda.marcar.usarSugestao', { data: dataBr(sugestao.data), hora: horaBr(sugestao.hora) })
        "
        @acionar="usarSugestao"
      />
    </div>
    <SanteAlerta v-else-if="semSugestao" variante="aviso" :texto="t('agenda.marcar.semSugestao')" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
