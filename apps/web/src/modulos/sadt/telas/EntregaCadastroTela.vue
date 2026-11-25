<script setup lang="ts">
// Prazos de entrega e publicação no portal (F3.5, 05-SADT linha 21): `/sadt/entregas/cadastro`. Três quadros, cada um
// com o formulário curto e a lista: o prazo de entrega por exame e setor (dá a previsão no balcão), o exame restrito
// no portal (nunca publica, só depois da entrega no balcão ou só depois da carência) e o perfil do portal (setores
// que vê, exames restritos e dias de visibilidade). A regra confere na hora; desativar nunca apaga.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ATENDIMENTOS_PRAZO,
  desativarCadastroEntrega,
  incluirPrazoEntrega,
  incluirRestricaoPortal,
  lerCadastroEntrega,
  type PerfilPortalCadastrado,
  PRIORIDADES_PRAZO,
  PUBLICOS_PORTAL,
  REGRAS_RESTRICAO,
  salvarPerfilPortal,
} from '../api-entrega.js';
import { lerOpcoesCatalogo } from '../api-limites.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t, tm, rt } = useI18n();
const P = 'sadt.entrega.cadastro';
const cliente = useQueryClient();
const cadastro = useQuery({ queryKey: ['sadt', 'entregas', 'cadastro'], queryFn: lerCadastroEntrega });
const opcoes = useQuery({ queryKey: ['sadt', 'catalogo', 'opcoes'], queryFn: lerOpcoesCatalogo });

const de = (xs: readonly { id: number; nome: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const exames = computed(() => de(opcoes.data.value?.exames, t(`${P}.escolha`)));
const setores = computed(() => de(cadastro.data.value?.setores, t(`${P}.todos`)));
const solicitantes = computed(() => de(cadastro.data.value?.setoresSolicitantes, t(`${P}.todos`)));
const prioridades = computed(() =>
  PRIORIDADES_PRAZO.map((p) => ({ valor: p, rotulo: t(`${P}.prioridades.${p}`) })),
);
const atendimentos = computed(() => [
  { valor: '', rotulo: t(`${P}.todos`) },
  ...ATENDIMENTOS_PRAZO.map((a) => ({ valor: a, rotulo: t(`${P}.atendimentos.${a}`) })),
]);
const regras = computed(() => REGRAS_RESTRICAO.map((r) => ({ valor: r, rotulo: t(`${P}.regras.${r}`) })));
const publicos = computed(() => PUBLICOS_PORTAL.map((p) => ({ valor: p, rotulo: t(`${P}.publicos.${p}`) })));
const diasDaSemana = computed(() => (tm(`${P}.diasDaSemana`) as unknown[]).map((d) => rt(d as string)));
const nomeSetor = (id: number) => cadastro.data.value?.setores.find((s) => s.id === id)?.nome ?? `#${id}`;
const idOuNulo = (v: string) => (v ? Number(v) : null);
const inteiroOuNulo = (v: string) => (v.trim() === '' ? null : Number(v));

// Prazo
const prazoVazio = () => ({
  exame: '',
  setor: '',
  solicitante: '',
  prioridade: 'rotina',
  atendimento: '',
  dias: '',
  minutos: '',
  corte: '',
  realiza: [true, true, true, true, true, true, true],
});
const prazo = ref(prazoVazio());
const prazoValido = computed(
  () =>
    !!prazo.value.exame &&
    (Number(prazo.value.dias || 0) > 0 || Number(prazo.value.minutos || 0) > 0) &&
    Number(prazo.value.dias || 0) <= 365 &&
    prazo.value.realiza.some(Boolean),
);
// Exame restrito
const restricao = ref({ exame: '', regra: 'nunca_publicar', carencia: '', motivo: '', global: false });
const restricaoValida = computed(
  () =>
    !!restricao.value.exame &&
    (restricao.value.regra !== 'apos_dias' || Number(restricao.value.carencia) >= 1),
);
// Perfil
const perfilVazio = () => ({
  id: null as number | null,
  versao: null as number | null,
  codigo: '',
  descricao: '',
  publico: 'paciente',
  setores: [] as number[],
  oculta: true,
  visibilidade: '',
  global: false,
});
const perfil = ref(perfilVazio());
const perfilValido = computed(
  () =>
    /^[A-Za-z0-9_.-]{2,30}$/.test(perfil.value.codigo.trim()) &&
    perfil.value.descricao.trim().length >= 3 &&
    (perfil.value.visibilidade.trim() === '' || Number(perfil.value.visibilidade) >= 1),
);
function editar(p: PerfilPortalCadastrado): void {
  perfil.value = {
    id: p.id,
    versao: p.versao,
    codigo: p.codigo,
    descricao: p.descricao,
    publico: p.publico,
    setores: [...p.setores],
    oculta: p.ocultaExameRestrito,
    visibilidade: p.diasVisibilidade === null ? '' : String(p.diasVisibilidade),
    global: p.global,
  };
}
function marcarSetor(id: number, ligado: boolean): void {
  perfil.value.setores = ligado
    ? [...new Set([...perfil.value.setores, id])]
    : perfil.value.setores.filter((s) => s !== id);
}

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function executar(fn: () => Promise<unknown>, ok: string, depois?: () => void): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = ok;
    depois?.();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'entregas', 'cadastro'] });
  } catch (x) {
    erro.value = x;
  }
}
const gravarPrazo = () =>
  executar(
    () =>
      incluirPrazoEntrega(
        {
          exame: Number(prazo.value.exame),
          setor: idOuNulo(prazo.value.setor),
          setorSolicitante: idOuNulo(prazo.value.solicitante),
          prioridade: prazo.value.prioridade,
          tipoAtendimento: prazo.value.atendimento || null,
          prazoDias: Number(prazo.value.dias || 0),
          prazoMinutos: inteiroOuNulo(prazo.value.minutos),
          horarioCorte: prazo.value.corte || null,
          diasDaSemana: prazo.value.realiza,
        },
        novaChave('entrega.prazo'),
      ),
    t(`${P}.gravado`),
    () => (prazo.value = prazoVazio()),
  );
const gravarRestricao = () =>
  executar(
    () =>
      incluirRestricaoPortal(
        {
          exame: Number(restricao.value.exame),
          regra: restricao.value.regra,
          diasCarencia: restricao.value.regra === 'apos_dias' ? Number(restricao.value.carencia) : null,
          motivo: restricao.value.motivo.trim() || null,
          global: restricao.value.global,
        },
        novaChave('entrega.restricao'),
      ),
    t(`${P}.gravado`),
  );
const gravarPerfil = () =>
  executar(
    () =>
      salvarPerfilPortal(
        {
          id: perfil.value.id,
          versao: perfil.value.versao,
          codigo: perfil.value.codigo.trim(),
          descricao: perfil.value.descricao.trim(),
          publico: perfil.value.publico,
          setores: perfil.value.setores,
          ocultaExameRestrito: perfil.value.oculta,
          diasVisibilidade: inteiroOuNulo(perfil.value.visibilidade),
          global: perfil.value.global,
        },
        novaChave('entrega.perfil'),
      ),
    t(`${P}.gravado`),
    () => (perfil.value = perfilVazio()),
  );
const desativar = (tipo: 'prazo' | 'restricao' | 'perfil', id: number) =>
  executar(() => desativarCadastroEntrega(tipo, id, novaChave('entrega.desativar')), t(`${P}.desativado`));
</script>

<template>
  <section class="cadastro" data-testid="entrega-cadastro">
    <h1>{{ t(`${P}.titulo`) }}</h1>
    <p>{{ t(`${P}.explicacao`) }}</p>
    <p v-if="mensagem" role="status" data-testid="entrega-cadastro-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
    <ErroSadt v-if="cadastro.isError.value" :erro="cadastro.error.value" />

    <fieldset data-testid="entrega-prazos">
      <legend>{{ t(`${P}.prazos`) }}</legend>
      <div class="linha">
        <SanteSelecao
          v-model="prazo.exame"
          :rotulo="t(`${P}.exame`)"
          :opcoes="exames"
          data-testid="prazo-exame"
        />
        <SanteSelecao
          v-model="prazo.setor"
          :rotulo="t(`${P}.setor`)"
          :opcoes="setores"
          data-testid="prazo-setor"
        />
        <SanteSelecao
          v-model="prazo.solicitante"
          :rotulo="t(`${P}.setorSolicitante`)"
          :opcoes="solicitantes"
        />
        <SanteSelecao
          v-model="prazo.prioridade"
          :rotulo="t(`${P}.prioridade`)"
          :opcoes="prioridades"
          data-testid="prazo-prioridade"
        />
        <SanteSelecao
          v-model="prazo.atendimento"
          :rotulo="t(`${P}.tipoAtendimento`)"
          :opcoes="atendimentos"
        />
        <label
          >{{ t(`${P}.dias`) }}<input v-model="prazo.dias" inputmode="numeric" data-testid="prazo-dias"
        /></label>
        <label
          >{{ t(`${P}.minutos`)
          }}<input v-model="prazo.minutos" inputmode="numeric" data-testid="prazo-minutos"
        /></label>
        <label
          >{{ t(`${P}.corte`) }}<input v-model="prazo.corte" type="time" data-testid="prazo-corte"
        /></label>
        <fieldset class="dias">
          <legend>{{ t(`${P}.realiza`) }}</legend>
          <label v-for="(d, i) in diasDaSemana" :key="i"
            ><input v-model="prazo.realiza[i]" type="checkbox" :data-testid="`prazo-dia-${i}`" />
            {{ d }}</label
          >
        </fieldset>
        <SanteBotao
          :rotulo="t(`${P}.incluir`)"
          :desabilitado="!prazoValido"
          data-testid="prazo-incluir"
          @acionar="gravarPrazo"
        />
      </div>
      <p v-if="!!prazo.exame && !prazoValido" role="status" data-testid="prazo-falta">
        {{ t(`${P}.faltaTempo`) }}
      </p>
      <p v-if="(cadastro.data.value?.prazos ?? []).length === 0">{{ t(`${P}.nenhum`) }}</p>
      <ul>
        <li v-for="p in cadastro.data.value?.prazos ?? []" :key="p.id" :class="{ inativa: !p.ativo }">
          {{ p.exameNome }} · {{ p.setor === null ? t(`${P}.todos`) : nomeSetor(p.setor) }} ·
          {{ t(`${P}.prioridades.${p.prioridade}`) }}
          <template v-if="p.tipoAtendimento"> · {{ t(`${P}.atendimentos.${p.tipoAtendimento}`) }}</template>
          · {{ t(`${P}.prazoCurto`, { dias: p.prazoDias }) }}
          <template v-if="p.prazoMinutos"> + {{ t(`${P}.minutosCurto`, { n: p.prazoMinutos }) }}</template>
          <template v-if="p.horarioCorte"> · {{ t(`${P}.corteCurto`, { hora: p.horarioCorte }) }}</template>
          ·
          {{ diasDaSemana.filter((_, i) => p.diasDaSemana[i]).join(' ') }}
          <span v-if="!p.ativo"> · {{ t(`${P}.inativo`) }}</span>
          <SanteBotao
            v-else
            :rotulo="t(`${P}.desativar`)"
            :data-testid="`prazo-desativar-${p.id}`"
            @acionar="desativar('prazo', p.id)"
          />
        </li>
      </ul>
    </fieldset>

    <fieldset data-testid="entrega-restricoes">
      <legend>{{ t(`${P}.restricoes`) }}</legend>
      <div class="linha">
        <SanteSelecao
          v-model="restricao.exame"
          :rotulo="t(`${P}.exame`)"
          :opcoes="exames"
          data-testid="restricao-exame"
        />
        <SanteSelecao
          v-model="restricao.regra"
          :rotulo="t(`${P}.regra`)"
          :opcoes="regras"
          data-testid="restricao-regra"
        />
        <label v-if="restricao.regra === 'apos_dias'"
          >{{ t(`${P}.carencia`)
          }}<input v-model="restricao.carencia" inputmode="numeric" data-testid="restricao-carencia"
        /></label>
        <label>{{ t(`${P}.motivo`) }}<input v-model="restricao.motivo" maxlength="500" /></label>
        <label><input v-model="restricao.global" type="checkbox" /> {{ t(`${P}.global`) }}</label>
        <SanteBotao
          :rotulo="t(`${P}.incluir`)"
          :desabilitado="!restricaoValida"
          data-testid="restricao-incluir"
          @acionar="gravarRestricao"
        />
      </div>
      <p v-if="(cadastro.data.value?.restricoes ?? []).length === 0">{{ t(`${P}.nenhum`) }}</p>
      <ul>
        <li v-for="r in cadastro.data.value?.restricoes ?? []" :key="r.id" :class="{ inativa: !r.ativo }">
          {{ r.exameNome }} · {{ t(`${P}.regras.${r.regra}`) }}
          <template v-if="r.diasCarencia !== null">
            · {{ t(`${P}.carenciaCurta`, { n: r.diasCarencia }) }}</template
          >
          <template v-if="r.motivo"> · {{ r.motivo }}</template>
          <template v-if="r.global"> · {{ t(`${P}.globalCurto`) }}</template>
          <span v-if="!r.ativo"> · {{ t(`${P}.inativo`) }}</span>
          <SanteBotao
            v-else
            :rotulo="t(`${P}.desativar`)"
            :data-testid="`restricao-desativar-${r.id}`"
            @acionar="desativar('restricao', r.id)"
          />
        </li>
      </ul>
    </fieldset>

    <fieldset data-testid="entrega-perfis">
      <legend>{{ t(`${P}.perfis`) }}</legend>
      <div class="linha">
        <label
          >{{ t(`${P}.codigo`) }}<input v-model="perfil.codigo" maxlength="30" data-testid="perfil-codigo"
        /></label>
        <label
          >{{ t(`${P}.descricao`)
          }}<input v-model="perfil.descricao" maxlength="150" data-testid="perfil-descricao"
        /></label>
        <SanteSelecao
          v-model="perfil.publico"
          :rotulo="t(`${P}.publico`)"
          :opcoes="publicos"
          data-testid="perfil-publico"
        />
        <label
          >{{ t(`${P}.visibilidade`)
          }}<input v-model="perfil.visibilidade" inputmode="numeric" data-testid="perfil-visibilidade"
        /></label>
        <label
          ><input v-model="perfil.oculta" type="checkbox" data-testid="perfil-oculta" />
          {{ t(`${P}.ocultaRestrito`) }}</label
        >
        <label><input v-model="perfil.global" type="checkbox" /> {{ t(`${P}.global`) }}</label>
        <fieldset class="dias">
          <legend>{{ t(`${P}.setoresDoPerfil`) }}</legend>
          <label v-for="s in cadastro.data.value?.setores ?? []" :key="s.id"
            ><input
              type="checkbox"
              :checked="perfil.setores.includes(s.id)"
              :data-testid="`perfil-setor-${s.id}`"
              @change="marcarSetor(s.id, ($event.target as HTMLInputElement).checked)"
            />
            {{ s.nome }}</label
          >
        </fieldset>
        <SanteBotao
          :rotulo="t(`${P}.salvar`)"
          :desabilitado="!perfilValido"
          data-testid="perfil-salvar"
          @acionar="gravarPerfil"
        />
        <SanteBotao v-if="perfil.id !== null" :rotulo="t(`${P}.novo`)" @acionar="perfil = perfilVazio()" />
      </div>
      <p v-if="(cadastro.data.value?.perfis ?? []).length === 0">{{ t(`${P}.nenhum`) }}</p>
      <ul>
        <li v-for="p in cadastro.data.value?.perfis ?? []" :key="p.id" :class="{ inativa: !p.ativo }">
          {{ p.codigo }} · {{ p.descricao }} · {{ t(`${P}.publicos.${p.publico}`) }} ·
          {{ p.setores.length === 0 ? t(`${P}.todosOsSetores`) : p.setores.map(nomeSetor).join(', ') }}
          <template v-if="!p.ocultaExameRestrito"> · {{ t(`${P}.veRestrito`) }}</template>
          <template v-if="p.diasVisibilidade !== null">
            · {{ t(`${P}.visibilidadeCurta`, { n: p.diasVisibilidade }) }}</template
          >
          <template v-if="p.global"> · {{ t(`${P}.globalCurto`) }}</template>
          <span v-if="!p.ativo"> · {{ t(`${P}.inativo`) }}</span>
          <SanteBotao
            :rotulo="t(`${P}.editar`)"
            :data-testid="`perfil-editar-${p.id}`"
            @acionar="editar(p)"
          />
          <SanteBotao
            v-if="p.ativo"
            :rotulo="t(`${P}.desativar`)"
            :data-testid="`perfil-desativar-${p.id}`"
            @acionar="desativar('perfil', p.id)"
          />
        </li>
      </ul>
    </fieldset>
  </section>
</template>

<style scoped>
.cadastro {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
label {
  display: grid;
  gap: 0.25rem;
}
.dias {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.dias label {
  display: block;
}
.inativa {
  opacity: 0.6;
}
</style>
